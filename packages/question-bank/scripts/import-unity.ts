/**
 * Convert the Unity QuestionBank.asset into a pack JSON file.
 *
 *   pnpm --filter @family-party/question-bank import-unity <path/to/QuestionBank.asset> <pack-id> "<Pack name>" > packs/<pack-id>.json
 *
 * Review the output (categories, correct answers, difficulty) before committing it,
 * then add the pack to PACKS in src/index.ts.
 */
import { readFileSync } from "node:fs";
import { importUnityAsset } from "../src/unity.ts";
import { validatePack } from "../src/pack.ts";

const [file, id = "familia", name = "Familia"] = process.argv.slice(2);
if (!file) {
  console.error("usage: import-unity <QuestionBank.asset> [pack-id] [pack name]");
  process.exit(1);
}

const pack = importUnityAsset(readFileSync(file, "utf8"), { id, name });
const errors = validatePack(pack);
if (errors.length) console.error(`⚠️  ${errors.length} problem(s):\n  ${errors.join("\n  ")}`);
console.error(`✓ ${pack.questions.length} questions converted`);
process.stdout.write(JSON.stringify(pack, null, 2) + "\n");
