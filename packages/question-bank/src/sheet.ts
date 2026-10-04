/**
 * Spreadsheet → pack: what a family member fills in, turned into a Pack.
 *
 * Pure (no Node APIs), so the CLI (services/game-session/scripts/pack.ts) uses it today
 * and a web editor can use the very same rules later.
 *
 * Columns (header names are matched ignoring case, accents and spaces):
 *   Categoría | Pregunta | Correcta | Incorrecta 1 … Incorrecta 5 | Dificultad | Segundos | Robable
 * Only Pregunta, Correcta and one Incorrecta are required. Everything else falls back to SHEET_DEFAULTS,
 * and an empty Categoría repeats the one above it. The game shuffles options when it deals,
 * so the correct answer can always go in its own column.
 */
import type { Difficulty } from "@family-party/game-core";
import { validatePack, type Pack, type PackQuestion } from "./pack";

/** What an empty cell means. Matches most of the classic pack. */
export const SHEET_DEFAULTS = { category: "General", difficulty: 1 as Difficulty, timeLimitSec: 20, stealable: true };

export const SHEET_HEADERS = ["Categoría", "Pregunta", "Correcta", "Incorrecta 1", "Incorrecta 2", "Incorrecta 3", "Incorrecta 4", "Incorrecta 5", "Dificultad", "Segundos", "Robable"];

export interface SheetResult {
  pack: Pack;
  /** Problems that stop the pack from being built (row numbers as the spreadsheet shows them). */
  errors: string[];
  /** Cells that fell back to a default, summarised. Fine to ignore. */
  notes: string[];
}

// ---------------------------------------------------------------- CSV

/**
 * RFC 4180 CSV: quoted fields, "" escapes, newlines inside quotes, CRLF, a UTF-8 BOM.
 * The delimiter is guessed from the header line: Excel in some locales exports with ";".
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field !== "" || row.length) row.push(field), rows.push(row);
  return rows;
}

// ---------------------------------------------------------------- sheet → pack

const key = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Header aliases, so "Respuesta correcta" or "Tiempo" work too. */
const COLUMNS = {
  category: ["categoria", "category", "tema"],
  text: ["pregunta", "question", "texto"],
  correct: ["correcta", "respuestacorrecta", "respuesta", "correct", "answer"],
  difficulty: ["dificultad", "difficulty", "nivel"],
  time: ["segundos", "tiempo", "time", "seconds", "timelimit"],
  stealable: ["robable", "robo", "stealable", "steal"],
} satisfies Record<string, string[]>;
type Column = keyof typeof COLUMNS;
const WRONG = /^(incorrecta|opcion|otra|wrong)(\d)$/;

/** Short, stable and the same in Node and the browser: FNV-1a, base 36. */
function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return h.toString(36).padStart(7, "0");
}
/** "Cine y TV" → "cine-y-tv": for pack ids and question id prefixes. */
export const slugify = (s: string, max = 32) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, max).replace(/-$/, "") || "x";

const YES = new Set(["si", "s", "yes", "y", "true", "1", "x"]);
const NO = new Set(["no", "n", "false", "0"]);
const NO_TIMER = new Set(["no", "sin", "sinlimite", "ninguno", "0", "none"]);

export function sheetToPack(rows: string[][], meta: { id: string; name: string; description?: string }): SheetResult {
  const errors: string[] = [];
  const defaulted = { category: 0, difficulty: 0, time: 0, stealable: 0 };
  const pack: Pack = { id: meta.id, name: meta.name, description: meta.description ?? "", questions: [] };

  // The header is the first row that has a Pregunta column (title rows above it are fine).
  const headerAt = rows.findIndex((r) => r.some((c) => COLUMNS.text.includes(key(c))));
  if (headerAt < 0) return { pack, errors: [`No encontré la fila de encabezados (necesita al menos: ${SHEET_HEADERS.slice(1, 4).join(", ")}).`], notes: [] };

  const col: Partial<Record<Column, number>> = {};
  const wrongCols: number[] = [];
  rows[headerAt]!.forEach((h, i) => {
    const k = key(h);
    for (const name of Object.keys(COLUMNS) as Column[]) if (COLUMNS[name].includes(k) && col[name] === undefined) col[name] = i;
    if (WRONG.test(k)) wrongCols.push(i);
  });
  if (col.correct === undefined) errors.push('Falta la columna "Correcta".');
  if (wrongCols.length === 0) errors.push('Falta al menos una columna "Incorrecta 1".');
  if (errors.length) return { pack, errors, notes: [] };

  let lastCategory = "";
  const seen = new Set<string>();
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const cell = (i: number | undefined) => (i === undefined ? "" : (row[i] ?? "").trim());
    if (row.every((c) => !c.trim())) continue; // blank line
    const line = `Fila ${r + 1}`;

    const text = cell(col.text);
    const correct = cell(col.correct);
    const wrong = wrongCols.map(cell).filter(Boolean);
    let category = cell(col.category);
    if (!category) {
      category = lastCategory || SHEET_DEFAULTS.category;
      defaulted.category++;
    }
    lastCategory = category;

    const problems: string[] = [];
    if (!text) problems.push("falta la pregunta");
    if (!correct) problems.push("falta la respuesta correcta");
    if (wrong.length === 0) problems.push("necesita al menos una respuesta incorrecta");
    const options = [correct, ...wrong];
    if (correct && new Set(options.map(key)).size !== options.length) problems.push("hay respuestas repetidas");

    let difficulty = SHEET_DEFAULTS.difficulty;
    const d = cell(col.difficulty);
    if (!d) defaulted.difficulty++;
    else if (/^[1-5]$/.test(d)) difficulty = Number(d) as Difficulty;
    else problems.push(`la dificultad debe ser del 1 al 5 (dice "${d}")`);

    let timeLimitSec: number | null = SHEET_DEFAULTS.timeLimitSec;
    const t = cell(col.time);
    if (!t) defaulted.time++;
    else if (NO_TIMER.has(key(t))) timeLimitSec = null;
    else if (/^\d+$/.test(t) && Number(t) >= 5 && Number(t) <= 120) timeLimitSec = Number(t);
    else problems.push(`los segundos deben ser de 5 a 120, o "sin" para no tener límite (dice "${t}")`);

    let stealable = SHEET_DEFAULTS.stealable;
    const s = key(cell(col.stealable));
    if (!s) defaulted.stealable++;
    else if (YES.has(s)) stealable = true;
    else if (NO.has(s)) stealable = false;
    else problems.push(`robable debe ser "sí" o "no" (dice "${cell(col.stealable)}")`);

    if (problems.length) {
      errors.push(`${line}: ${problems.join("; ")}.`);
      continue;
    }

    // Same question twice in a category is almost always a copy-paste slip.
    const ident = `${key(category)}|${key(text)}`;
    if (seen.has(ident)) {
      errors.push(`${line}: esta pregunta ya está arriba en "${category}".`);
      continue;
    }
    seen.add(ident);

    // The id comes from category + question, so reordering rows or fixing an answer keeps it:
    // rooms use ids to deal fresh questions first after a rematch.
    const q: PackQuestion = {
      id: `${slugify(category, 20)}-${fingerprint(ident)}`,
      category,
      text,
      options,
      correct: [0],
      difficulty,
      timeLimitSec,
      stealable,
    };
    pack.questions.push(q);
  }

  if (!errors.length && pack.questions.length === 0) errors.push("La hoja no tiene preguntas.");
  if (!errors.length) errors.push(...validatePack(pack)); // belt and braces: same rules as every other pack

  const n = (k: keyof typeof defaulted) => defaulted[k];
  const notes = [
    n("category") && `${n("category")} sin categoría: usé la de la fila de arriba (o "${SHEET_DEFAULTS.category}")`,
    n("difficulty") && `${n("difficulty")} sin dificultad: ${SHEET_DEFAULTS.difficulty}`,
    n("time") && `${n("time")} sin segundos: ${SHEET_DEFAULTS.timeLimitSec}`,
    n("stealable") && `${n("stealable")} sin robable: sí`,
  ].filter((x): x is string => Boolean(x));

  return { pack, errors, notes };
}
