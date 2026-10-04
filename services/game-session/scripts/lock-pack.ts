/**
 * Lock a private pack with an unlock code, ready to upload to the packs bucket.
 *
 *   pnpm --filter @family-party/game-session lock-pack <pack.json> <CODE> [out.json]
 *
 * Keep pack files OUTSIDE this repo (it's public). Only the scrypt hash of the code is
 * written; share the code itself with your family through a private channel.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MIN_CODE_LENGTH, displayCode, hashCode, normalizeCode, parsePrivatePack } from "../src/packs";

const [inputArg, code, outputArg] = process.argv.slice(2);
// pnpm --filter runs scripts from this package's folder; resolve paths from where you typed the command.
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
const input = inputArg && here(inputArg);
const output = outputArg && here(outputArg);
if (!input || !code) {
  console.error("usage: lock-pack <pack.json> <CODE> [out.json]   e.g. lock-pack familia.json TAMALESABUELA26");
  process.exit(1);
}

const normalized = normalizeCode(code);
if (normalized.length < MIN_CODE_LENGTH) {
  console.error(`The code is too short (${normalized.length} letters and digits). Use at least ${MIN_CODE_LENGTH}, e.g. TAMALESABUELA26.`);
  process.exit(1);
}

const { access: _old, ...pack } = JSON.parse(await readFile(input, "utf8")) as Record<string, unknown>;
const locked = { ...pack, access: await hashCode(code) };
const parsed = parsePrivatePack(locked);
if (!parsed.ok) {
  console.error("The pack has problems:\n  " + parsed.errors.join("\n  "));
  process.exit(1);
}

const out = output || input.replace(/\.json$/i, "") + ".locked.json";
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(locked, null, 2) + "\n");
const { id } = parsed.value.pack;
console.log(`Locked "${id}" (${parsed.value.pack.questions.length} questions) → ${out}`);
console.log(`Code to share: ${displayCode(code)}  (case, accents, spaces and dashes don't matter when redeeming)`);
console.log(`Upload:  aws s3 cp "${out}" s3://<packs bucket>/packs/${id}.json --profile family-party`);
