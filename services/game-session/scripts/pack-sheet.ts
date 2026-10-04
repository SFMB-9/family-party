/**
 * Spreadsheet → locked private pack → packs bucket, in one command.
 *
 *   pnpm --filter @family-party/game-session pack-sheet <sheet.csv> --code <CODE> [--name "Familia"] [--id familia] [--upload]
 *
 * 1. Export the sheet as CSV (Google Sheets: File → Download → .csv). Template: packages/question-bank/templates/plantilla.csv
 * 2. Without --upload it only checks the sheet and writes <sheet>.locked.json next to it: run it until there are no errors.
 * 3. With --upload it also puts the pack in s3://$PACKS_BUCKET/packs/<id>.json using your SSO profile
 *    (AWS_PROFILE, default family-party). The game picks it up within a minute.
 *
 * Keep sheets OUTSIDE this repo (it's public). Only the scrypt hash of the code is written anywhere;
 * share the code itself through a private channel. Uploading again with the same --id replaces the pack
 * (and its code: pass the same code to keep it).
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseCsv, sheetToPack, slugify } from "@family-party/question-bank";
import { MIN_CODE_LENGTH, displayCode, hashCode, normalizeCode, parsePrivatePack } from "../src/packs";

// pnpm --filter runs scripts from this package's folder; resolve paths from where you typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
const fail = (...lines: string[]) => {
  console.error(lines.join("\n"));
  process.exit(1);
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    code: { type: "string" },
    name: { type: "string" },
    id: { type: "string" },
    description: { type: "string" },
    upload: { type: "boolean", default: false },
  },
});
const [input] = positionals;
if (!input || !values.code) {
  fail('usage: pack-sheet <sheet.csv> --code <CODE> [--name "Familia"] [--id familia] [--upload]');
}

const code = values.code!;
if (normalizeCode(code).length < MIN_CODE_LENGTH) {
  fail(`The code is too short (${normalizeCode(code).length} letters and digits). Use at least ${MIN_CODE_LENGTH}, e.g. TAMALESABUELA26.`);
}

const file = here(input!);
const stem = basename(file, extname(file));
const name = values.name ?? stem;
const id = values.id ?? slugify(name);

/** Google Sheets exports UTF-8; Excel's plain "CSV" on Windows saves Windows-1252, which would mangle every accent. */
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

const { pack, errors, notes } = sheetToPack(parseCsv(decode(await readFile(file))), { id, name, description: values.description });
if (errors.length) fail(`The sheet has ${errors.length} problem(s):`, ...errors.map((e) => "  " + e));

const locked = { ...pack, access: await hashCode(code) };
const parsed = parsePrivatePack(locked); // the exact check the Lambda runs before trusting a file
if (!parsed.ok) fail("The pack has problems:", ...parsed.errors.map((e) => "  " + e));

const out = resolve(file, "..", `${stem}.locked.json`);
await writeFile(out, JSON.stringify(locked, null, 2) + "\n");

const perCategory = new Map<string, number>();
for (const q of pack.questions) perCategory.set(q.category, (perCategory.get(q.category) ?? 0) + 1);
console.log(`"${name}" (id ${id}): ${pack.questions.length} questions`);
for (const [category, n] of perCategory) console.log(`  ${category}: ${n}`);
if (notes.length) console.log("Defaults used:\n" + notes.map((n) => "  " + n).join("\n"));
console.log(`Locked → ${out}`);

if (!values.upload) {
  console.log("Looks good? Run it again with --upload.");
} else {
  const bucket = process.env.PACKS_BUCKET;
  if (!bucket) fail("Set PACKS_BUCKET first (terraform output packs_bucket in infra/live), e.g.  set PACKS_BUCKET=family-party-packs-<account>");
  process.env.AWS_PROFILE ??= "family-party";
  // Imported here so a dry run never needs AWS credentials.
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? "mx-central-1" });
  const key = `packs/${id}.json`;
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(locked), ContentType: "application/json" }));
  } catch (e) {
    const err = e as Error;
    fail(
      `Upload failed: ${err.name}: ${err.message}`,
      /token|expired|sso|credential/i.test(err.message + err.name) ? `Try:  aws sso login --profile ${process.env.AWS_PROFILE}` : "",
    );
  }
  console.log(`Uploaded → s3://${bucket}/${key}  (live in the game within a minute)`);
}
console.log(`Code to share privately: ${displayCode(code)}`);
