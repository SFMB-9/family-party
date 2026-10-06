/**
 * A second pair of eyes on a sheet before it ships: things that are valid but probably wrong.
 *
 * sheetToPack answers "can this become a pack?"; reviewSheet answers "should it, as is?".
 * Pure, like sheet.ts, so the CLI (scripts/pack-review.ts) and a future editor share the same rules.
 * Nothing here blocks an upload: it's a checklist for a person to read.
 *
 * Extra columns it understands (the validator ignores them):
 *   Rev   anything written here means "not finished" (★?, "★? pendiente"…)
 *   Nota  author notes; ones that ask for a check ("revisa", "confirma"…) are listed
 */
import { parseCsv, sheetToPack } from "./sheet";

export type FindingKind =
  | "error" // sheetToPack refused the row: the pack won't build
  | "small-category"
  | "unfinished" // something in Rev
  | "duplicate" // same question in another category (same category is already an error)
  | "giveaway" // the correct answer is much longer than every distractor
  | "check-note" // a Nota asking someone to verify something
  | "address"
  | "sensitive"
  | "secret"; // looks like a code or password

export interface Finding {
  kind: FindingKind;
  /** Row number as the spreadsheet shows it (1 = header row). Absent for whole-sheet findings. */
  row?: number;
  message: string;
}

export interface Review {
  questions: number;
  categories: { name: string; count: number }[];
  findings: Finding[];
}

export const REVIEW_DEFAULTS: {
  minPerCategory: number;
  giveawayRatio: number;
  giveawayChars: number;
  /** Extra word starts to flag as sensitive, kept outside this public repo (see pack-review). */
  sensitiveWords: string[];
} = {
  /** Fewer than this and a category can run dry on a big board. */
  minPerCategory: 12,
  /** Correct answer longer than this many times the longest distractor… */
  giveawayRatio: 1.8,
  /** …and at least this many characters longer. */
  giveawayChars: 12,
  sensitiveWords: [],
};

const key = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Lowercase, no accents, words kept apart: what the word lists below match against. */
const words = (s: string) => " " + s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9#]+/g, " ") + " ";

// Word lists match the start of a word ("revis" → revisa, revisar), never the middle ("sacó" is not "saco").
const CHECK = ["revis", "confirm", "ajust", "verific", "falta", "pendiente", "checa", "corrobor"];
/** Already done: "Confirmado en el árbol" is a note, not a to-do. */
const DONE = ["confirmad", "verificad", "revisad", "corroborad", "ajustad"];
const SENSITIVE = [
  "sexo", "sexual", "porno", "desnud",
  "enfermedad", "cancer", "diagnost", "hospital", "cirugia", "depresion", "ansiedad", "terapia", "psiquiatr", "embaraz", "aborto",
  "divorci", "infiel", "engano", "odia", "odio", "pelea", "demanda", "arrest", "carcel", "droga",
];
/** "Calle Pino 23", "Av. Reforma 222", "número 5", "#12": a street with a number. */
const ADDRESS = /\b(calle|avenida|av|privada|andador|callejon|boulevard|blvd|calzada)\s+(\w+\s+){0,4}\d+|\b(numero|num)\s+\d+|#\s*\d+/;
const NEIGHBOURHOOD = /\b(colonia|col|fraccionamiento|fracc)\b/;
const SECRET_WORD = /\b(codigo|contrasena|password|clave|pin)\b/;
/** A redeem-style code: one block of 12+ capitals and digits with at least one of each. */
const CODE_LIKE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{12,}\b/;

const hasWord = (text: string, list: string[]) => list.find((w) => text.includes(" " + w));
const WRONG = /^(incorrecta|opcion|otra|wrong)(\d)$/;

export function reviewSheet(rows: string[][], options: Partial<typeof REVIEW_DEFAULTS> = {}): Review {
  const opts = { ...REVIEW_DEFAULTS, ...options };
  const findings: Finding[] = [];
  const add = (kind: FindingKind, message: string, row?: number) => findings.push({ kind, message, ...(row ? { row } : {}) });

  // Validation first: the same function the upload runs, with a throwaway id and name.
  const { pack, errors } = sheetToPack(rows, { id: "review", name: "review" });
  for (const e of errors) {
    const m = /^Fila (\d+): (.*)$/.exec(e);
    add("error", m ? m[2]! : e, m ? Number(m[1]) : undefined);
  }

  const counts = new Map<string, number>();
  for (const q of pack.questions) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  for (const [name, n] of counts) if (n < opts.minPerCategory) add("small-category", `"${name}" tiene ${n} (menos de ${opts.minPerCategory})`);

  const headerAt = rows.findIndex((r) => r.some((c) => ["pregunta", "question", "texto"].includes(key(c))));
  if (headerAt >= 0) {
    const header = rows[headerAt]!.map(key);
    const at = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const c = {
      category: at("categoria", "category", "tema"),
      text: at("pregunta", "question", "texto"),
      correct: at("correcta", "respuestacorrecta", "respuesta", "correct", "answer"),
      rev: at("rev", "revision", "estado"),
      note: at("nota", "notas", "note", "notes"),
    };
    const wrongCols = header.map((h, i) => (WRONG.test(h) ? i : -1)).filter((i) => i >= 0);

    const firstSeen = new Map<string, { row: number; category: string }>();
    let category = "";
    for (let r = headerAt + 1; r < rows.length; r++) {
      const row = rows[r]!;
      if (row.every((x) => !x.trim())) continue;
      const line = r + 1;
      const cell = (i: number) => (i < 0 ? "" : (row[i] ?? "").trim());
      category = cell(c.category) || category;
      const text = cell(c.text);
      const correct = cell(c.correct);
      const wrong = wrongCols.map(cell).filter(Boolean);
      const note = cell(c.note);
      const short = text.length > 70 ? text.slice(0, 67) + "…" : text;

      const rev = cell(c.rev);
      if (rev) add("unfinished", `Rev "${rev}": ${short}${note ? ` (nota: ${note})` : ""}`, line);

      if (text) {
        const seen = firstSeen.get(key(text));
        if (seen && seen.category !== category) add("duplicate", `repite la fila ${seen.row} (${seen.category}): ${short}`, line);
        else if (!seen) firstSeen.set(key(text), { row: line, category });
      }

      const longest = Math.max(0, ...wrong.map((w) => w.length));
      if (correct && longest && correct.length > opts.giveawayRatio * longest && correct.length - longest >= opts.giveawayChars) {
        add("giveaway", `la correcta (${correct.length} letras) es mucho más larga que las demás (máx. ${longest}): "${correct}"`, line);
      }

      if (note && hasWord(words(note), CHECK) && !hasWord(words(note), DONE)) add("check-note", `${note} — ${short}`, line);

      // Privacy looks at the whole row, notes included: notes ship to nobody, but they're in the sheet people share.
      const all = row.join(" ");
      const plain = words(all);
      if (ADDRESS.test(plain)) add("address", `parece un domicilio con número: ${short}`, line);
      else if (NEIGHBOURHOOD.test(plain)) add("address", `menciona una colonia (sola es aceptable): ${short}`, line);
      const sensitive = hasWord(plain, SENSITIVE) ?? hasWord(plain, opts.sensitiveWords.map((w) => words(w).trim()).filter(Boolean));
      if (sensitive) add("sensitive", `tema sensible ("${sensitive}…"): ${short}`, line);
      if (SECRET_WORD.test(plain) || CODE_LIKE.test(all)) add("secret", `parece un código o contraseña: ${short}`, line);
    }
  }

  return {
    questions: pack.questions.length,
    categories: [...counts].map(([name, count]) => ({ name, count })),
    findings,
  };
}

// ---------------------------------------------------------------- new sheet vs the copy you have

export interface SheetDiff {
  added: { row: number; text: string }[];
  removed: { row: number; text: string }[];
  /** Same question, some other cell changed. Rows are the new sheet's. */
  changed: { row: number; text: string; cells: { column: string; before: string; after: string }[] }[];
  columnsAdded: string[];
  /** `empty` = every cell under it was blank in the old sheet, so nothing is lost. */
  columnsRemoved: { name: string; empty: boolean }[];
}

/** Compares by question text (ignoring case, accents and punctuation), so reordering rows isn't a change. */
export function diffSheets(before: string[][], after: string[][]): SheetDiff {
  const table = (rows: string[][]) => {
    const headerAt = Math.max(0, rows.findIndex((r) => r.some((c) => ["pregunta", "question", "texto"].includes(key(c)))));
    const header = (rows[headerAt] ?? []).map((h) => h.trim());
    const textCol = header.findIndex((h) => ["pregunta", "question", "texto"].includes(key(h)));
    const byText = new Map<string, { row: number; text: string; cells: Map<string, string> }>();
    const body = rows.slice(headerAt + 1);
    body.forEach((r, i) => {
      if (r.every((x) => !x.trim())) return;
      const text = (r[textCol] ?? "").trim();
      if (!text) return;
      byText.set(key(text), { row: headerAt + 2 + i, text, cells: new Map(header.map((h, j) => [h, (r[j] ?? "").trim()])) });
    });
    return { header, byText, body };
  };
  const a = table(before);
  const b = table(after);
  const sameName = (list: string[], name: string) => list.some((h) => key(h) === key(name));

  const diff: SheetDiff = { added: [], removed: [], changed: [], columnsAdded: [], columnsRemoved: [] };
  diff.columnsAdded = b.header.filter((h) => h && !sameName(a.header, h));
  diff.columnsRemoved = a.header
    .filter((h) => h && !sameName(b.header, h))
    .map((name) => ({ name, empty: a.body.every((r) => !(r[a.header.indexOf(name)] ?? "").trim()) }));

  for (const [k, row] of b.byText) {
    const old = a.byText.get(k);
    if (!old) {
      diff.added.push({ row: row.row, text: row.text });
      continue;
    }
    const cells: SheetDiff["changed"][number]["cells"] = [];
    for (const column of b.header) {
      const oldName = a.header.find((h) => key(h) === key(column));
      if (!oldName) continue;
      const before = old.cells.get(oldName) ?? "";
      const after = row.cells.get(column) ?? "";
      if (before !== after) cells.push({ column, before, after });
    }
    if (cells.length) diff.changed.push({ row: row.row, text: row.text, cells });
  }
  for (const [k, row] of a.byText) {
    if (!b.byText.has(k)) diff.removed.push({ row: row.row, text: row.text });
  }
  return diff;
}

/** Convenience for callers holding CSV text. */
export const reviewCsv = (csv: string, options?: Partial<typeof REVIEW_DEFAULTS>) => reviewSheet(parseCsv(csv), options);
