/**
 * Read-only checklist for a pack sheet: validates it like pack-sheet does, then lists what a person should look at.
 * Never needs a code, never writes a lock, never touches AWS.
 *
 *   pnpm --filter @family-party/game-session pack-review <sheet.csv> [--against <old.csv>] [--json]
 *
 * --against  compare with the copy you already have (usually the one in private-packs): new, removed and changed questions.
 * --json     machine-readable output (what the "Revisar e importar packs" task reads).
 *
 * Extra sensitive words (one per line, # for comments) can live in ~/.family-party/review-words.txt
 * (or PACK_REVIEW_WORDS): outside this public repo, so the list never hints at what's in a private pack.
 *
 * Exit code: 0 = builds and nothing would be lost, 1 = the sheet has errors, 2 = builds but --against would lose questions.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "@family-party/question-bank";
// Its own entry point, so the review rules stay out of the Lambda bundle.
import { diffSheets, reviewSheet, type Finding, type FindingKind } from "@family-party/question-bank/review";

const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { against: { type: "string" }, json: { type: "boolean", default: false }, min: { type: "string" } },
});
const [input] = positionals;
if (!input) {
  console.error("usage: pack-review <sheet.csv> [--against <old.csv>] [--json] [--min 12]");
  process.exit(1);
}

/** Same rule as pack-sheet: Google exports UTF-8, Excel on Windows may save Windows-1252. */
function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
const load = async (p: string) => parseCsv(decode(await readFile(here(p))));

const rows = await load(input);
const wordsFile = process.env.PACK_REVIEW_WORDS || join(homedir(), ".family-party", "review-words.txt");
const sensitiveWords = await readFile(wordsFile, "utf8").then(
  (text) => text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean),
  () => [] as string[], // no local list: the built-in one still applies
);
const review = reviewSheet(rows, { sensitiveWords, ...(values.min ? { minPerCategory: Number(values.min) } : {}) });
let diff;
if (values.against) {
  try {
    diff = diffSheets(await load(values.against), rows);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    diff = null; // no local copy yet: everything is new
  }
}

const hasErrors = review.findings.some((f) => f.kind === "error");
const losesQuestions = Boolean(diff && diff.removed.length);
process.exitCode = hasErrors ? 1 : losesQuestions ? 2 : 0;

if (values.json) {
  console.log(JSON.stringify({ file: input, ...review, against: values.against ?? null, diff: diff ?? null, ok: !hasErrors, losesQuestions }, null, 2));
} else {
  const TITLES: Record<FindingKind, string> = {
    error: "Errores (el pack no se construye)",
    "small-category": "Categorías chicas",
    unfinished: "Filas sin terminar (Rev) — el validador las deja pasar",
    duplicate: "Preguntas repetidas en otra categoría",
    giveaway: "Respuestas que se delatan por largas",
    "check-note": "Notas que piden verificar algo",
    address: "Domicilios",
    sensitive: "Temas sensibles",
    secret: "Códigos o contraseñas",
  };
  console.log(`${input}: ${review.questions} preguntas`);
  for (const c of review.categories) console.log(`  ${c.name}: ${c.count}`);
  const groups = new Map<FindingKind, Finding[]>();
  for (const f of review.findings) groups.set(f.kind, [...(groups.get(f.kind) ?? []), f]);
  for (const [kind, list] of groups) {
    console.log(`\n${TITLES[kind]} (${list.length})`);
    for (const f of list) console.log(`  ${f.row ? `Fila ${f.row}: ` : ""}${f.message}`);
  }
  if (!review.findings.length) console.log("\nSin observaciones.");

  if (values.against) {
    console.log(`\nContra ${values.against}:`);
    if (diff === null) console.log("  no existe: todo es nuevo.");
    else if (diff) {
      const { added, removed, changed, columnsAdded, columnsRemoved } = diff;
      if (!added.length && !removed.length && !changed.length && !columnsAdded.length && !columnsRemoved.length) console.log("  sin cambios.");
      for (const q of added) console.log(`  + Fila ${q.row}: ${q.text}`);
      for (const q of removed) console.log(`  − (antes fila ${q.row}) ${q.text}`);
      for (const q of changed) for (const c of q.cells) console.log(`  ~ Fila ${q.row} ${c.column}: "${c.before}" → "${c.after}"`);
      for (const c of columnsAdded) console.log(`  + columna ${c}`);
      for (const c of columnsRemoved) console.log(`  − columna ${c.name}${c.empty ? " (estaba vacía)" : ""}`);
      if (removed.length) console.log(`  ⚠ Se perderían ${removed.length} pregunta(s): no sobrescribas sin revisarlo.`);
    }
  }
}
