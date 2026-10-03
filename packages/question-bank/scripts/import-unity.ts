/**
 * Convert the Unity QuestionBank.asset into a pack JSON file.
 *
 *   pnpm --filter @family-party/question-bank import-unity <path/to/QuestionBank.asset> <pack-id> "<Pack name>" > <somewhere outside the repo>/<pack-id>.json
 *
 * Personal packs (family trivia) must NOT go into packs/: this repo is public.
 * They belong in the private packs bucket. Only public trivia goes in packs/.
 */
import { readFileSync } from "node:fs";
import { importUnityAsset } from "../src/unity.ts";
import { validatePack } from "../src/pack.ts";

const [file, id = "importado", name = "Importado"] = process.argv.slice(2);
if (!file) {
  console.error("usage: import-unity <QuestionBank.asset> [pack-id] [pack name]");
  process.exit(1);
}

const pack = importUnityAsset(readFileSync(file, "utf8"), { id, name });
const errors = validatePack(pack);
if (errors.length) console.error(`⚠️  ${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
console.error(`✓ ${pack.questions.length} questions converted`);
process.stdout.write(JSON.stringify(pack, null, 2) + "\n");
