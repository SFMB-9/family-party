/**
 * Spreadsheet → locked private pack → packs bucket, in one command.
 *
 *   pnpm --filter @family-party/game-session pack-sheet <sheet.csv> --id <pack id> [--upload]
 *
 * 1. Export the sheet as CSV (Google Sheets: File → Download → .csv). Template: packages/question-bank/templates/plantilla.csv
 * 2. The code and name come from your codes file, by pack id: ~/.family-party/codes.json (or PACK_CODES_FILE),
 *    kept OUTSIDE this repo and outside the folder with the CSVs. Template: packages/question-bank/templates/codes.example.json
 *    `--code`/`--name` still override it (one-offs, or just checking a sheet with a throwaway code).
 * 3. Without --upload it only checks the sheet and writes <sheet>.locked.json next to it: run it until there are no errors.
 *    Once that lock exists, --id can be left out: it's read from the lock.
 * 4. With --upload it also puts the pack in s3://$PACKS_BUCKET/packs/<id>.json using your SSO profile
 *    (AWS_PROFILE, default family-party). The game picks it up within a minute.
 *
 * One pack = one id: uploading again with the same id replaces it, a different id adds a second pack.
 * So it refuses, unless you say so on purpose:
 *   --new-id    this CSV was locked under another id (the old pack stays in the bucket until you delete it)
 *   --new-code  the code differs from the one already locked (local lock or the bucket's copy): players need the new one
 *
 * Keep sheets OUTSIDE this repo (it's public). Only the scrypt hash of the code is written anywhere.
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseCsv, sheetToPack, slugify } from "@family-party/question-bank";
import { codeChange, codesPath, entryProblem, parseCodes, type CodeEntry } from "../src/pack-codes";
import { MIN_CODE_LENGTH, displayCode, hashCode, normalizeCode, parsePrivatePack, type Access } from "../src/packs";

// pnpm --filter runs scripts from this package's folder; resolve paths from where you typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
const fail = (...lines: string[]): never => {
  console.error(lines.filter(Boolean).join("\n"));
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
    "new-code": { type: "boolean", default: false },
    "new-id": { type: "boolean", default: false },
  },
});
const [input] = positionals;
if (!input) fail('usage: pack-sheet <sheet.csv> [--id <pack id>] [--upload] [--new-code] [--new-id]   (or --code <CODE> --name "…" for a one-off)');

const file = here(input!);
const stem = basename(file, extname(file));
const lockPath = resolve(file, "..", `${stem}.locked.json`);

/** What this CSV was locked as last time, if it ever was. */
async function readLock(path: string): Promise<{ id: string; access?: Access } | undefined> {
  try {
    const json = JSON.parse(await readFile(path, "utf8")) as { id?: unknown; access?: Access };
    return typeof json.id === "string" ? { id: json.id, access: json.access } : undefined;
  } catch {
    return undefined;
  }
}

async function readCodes(): Promise<Map<string, CodeEntry>> {
  const path = codesPath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return fail(
      `No codes file at ${path}.`,
      "Copy packages/question-bank/templates/codes.example.json there and fill in the codes (or set PACK_CODES_FILE),",
      "or pass --code for a one-off.",
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return fail(`${path} isn't valid JSON: ${(e as Error).message}`);
  }
  const parsed = parseCodes(json);
  return parsed.ok ? parsed.value : fail(`${path} has problems:`, ...parsed.errors.map((e) => "  " + e));
}

const previous = await readLock(lockPath);
const id = values.id ?? previous?.id ?? slugify(values.name ?? stem);
let entry: CodeEntry | undefined;
if (!values.code) {
  entry = (await readCodes()).get(id);
  const problem = entryProblem(id, entry);
  if (problem) fail(problem);
}
const code = values.code ?? entry!.code;
const name = values.name ?? entry?.name ?? stem;
if (normalizeCode(code).length < MIN_CODE_LENGTH) {
  fail(`The code is too short (${normalizeCode(code).length} letters and digits). Use at least ${MIN_CODE_LENGTH}, e.g. TAMALESABUELA26.`);
}

if (previous && previous.id !== id && !values["new-id"]) {
  fail(
    `${basename(lockPath)} says this sheet is the pack "${previous.id}", not "${id}".`,
    `Uploading it as "${id}" would leave two packs in the game. Use --id ${previous.id}, or --new-id if the change is on purpose`,
    `(then delete s3://…/packs/${previous.id}.json yourself).`,
  );
}

/** Every place a code is compared runs through here, so a typo can't silently re-key a pack people already use. */
async function guardCode(where: string, access: Access | undefined) {
  const change = await codeChange(code, access);
  if (change === "changed" && !values["new-code"]) {
    fail(
      `The code for "${id}" doesn't match the one in ${where}.`,
      "Fix it in the codes file, or pass --new-code if you're changing it on purpose (everyone will need the new one).",
    );
  }
  return change;
}
let change = previous?.id === id ? await guardCode(basename(lockPath), previous.access) : "new";

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

const out = lockPath;
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
  const { S3Client, GetObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? "mx-central-1" });
  const key = `packs/${id}.json`;
  const hint = (err: Error) =>
    /token|expired|sso|credential/i.test(err.message + err.name) ? `Try:  aws sso login --profile ${process.env.AWS_PROFILE}` : "";
  // The bucket's copy is the one players unlock today, so it has the last word on whether the code changes.
  let live: Access | undefined;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    live = (JSON.parse((await object.Body?.transformToString()) ?? "null") as { access?: Access } | null)?.access;
  } catch (e) {
    const err = e as Error;
    if (err.name !== "NoSuchKey") fail(`Couldn't read ${key} to compare codes: ${err.name}: ${err.message}`, hint(err));
  }
  change = await guardCode(`s3://${bucket}/${key}`, live);
  if (change === "new") console.log(`"${id}" isn't in the bucket yet: this adds a new pack.`);
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(locked), ContentType: "application/json" }));
  } catch (e) {
    const err = e as Error;
    fail(`Upload failed: ${err.name}: ${err.message}`, hint(err));
  }
  console.log(`Uploaded → s3://${bucket}/${key}  (live in the game within a minute)`);
}
// Only worth showing when players need it: a new pack, a new code, or a one-off --code.
if (change !== "same" || values.code) console.log(`Code to share privately: ${displayCode(code)}`);
else console.log("Code unchanged.");
