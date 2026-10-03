/**
 * Pack format, validation and selection. No JSON imports here, so plain Node
 * (scripts/import-unity.ts) can load this file too.
 */
import type { Difficulty, Pick, Question } from "@family-party/game-core";
import type { PackInfo } from "@family-party/protocol";

/** Authoring format: what a person (or the Unity importer) writes in a pack file. */
export interface PackQuestion {
  id: string;
  category: string;
  text: string;
  options: string[];
  correct: number[];          // indexes into options; any of them counts
  difficulty: Difficulty;     // 1–5; points default to difficulty × 100
  points?: number;
  timeLimitSec: number | null;
  stealable: boolean;
  hidden?: boolean;           // kept in the pack, never dealt
  image?: string;             // URL, shown with the prompt
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  questions: PackQuestion[];
}

// ---------------------------------------------------------------- validation

/** Returns a list of human-readable problems; empty means the pack is valid. */
export function validatePack(pack: Pack): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  if (!pack.id || !pack.name) errors.push("pack needs an id and a name");

  for (const q of pack.questions) {
    const where = `${pack.id}/${q.id}`;
    if (ids.has(q.id)) errors.push(`${where}: duplicate id`);
    ids.add(q.id);
    if (!q.text.trim()) errors.push(`${where}: empty text`);
    if (!q.category.trim()) errors.push(`${where}: empty category`);
    if (q.options.length < 2 || q.options.length > 6) errors.push(`${where}: needs 2–6 options`);
    if (new Set(q.options).size !== q.options.length) errors.push(`${where}: duplicate options`);
    if (q.correct.length === 0) errors.push(`${where}: no correct answer`);
    if (q.correct.some((i) => !Number.isInteger(i) || i < 0 || i >= q.options.length)) {
      errors.push(`${where}: correct index out of range`);
    }
    if (![1, 2, 3, 4, 5].includes(q.difficulty)) errors.push(`${where}: difficulty must be 1–5`);
    if (q.timeLimitSec !== null && !(q.timeLimitSec >= 5 && q.timeLimitSec <= 120)) {
      errors.push(`${where}: timeLimitSec must be 5–120 or null`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------- conversion & selection

export function toGameQuestion(q: PackQuestion): Question {
  return {
    id: q.id,
    category: q.category,
    prompt: q.image ? { text: q.text, media: { kind: "image", url: q.image } } : { text: q.text },
    response: { kind: "choice", options: q.options, correct: q.correct },
    mode: "turn",
    difficulty: q.difficulty,
    ...(q.points !== undefined && { points: q.points }),
    timeLimitMs: q.timeLimitSec === null ? null : q.timeLimitSec * 1000,
    stealable: q.stealable,
  };
}

export interface Selection {
  /** Exact (pack, category) pairs, as picked in the lobby. When present, packs/categories are ignored. */
  picks?: Pick[];
  packs?: string[];        // legacy (rooms created on the home page): default all packs
  categories?: string[];   // legacy: default every category in those packs
}

/** The questions a room may deal from. Hidden questions are never included. */
export function selectQuestions(selection: Selection, packs: Pack[]): Question[] {
  if (selection.picks?.length) {
    const wanted = new Set(selection.picks.map((p) => pickKey(p.pack, p.category)));
    return packs
      .flatMap((p) => p.questions.filter((q) => !q.hidden && wanted.has(pickKey(p.id, q.category))))
      .map(toGameQuestion);
  }

  const chosenPacks = selection.packs?.length ? packs.filter((p) => selection.packs!.includes(p.id)) : packs;
  const wanted = selection.categories?.length ? new Set(selection.categories) : null;

  return chosenPacks
    .flatMap((p) => p.questions)
    .filter((q) => !q.hidden && (wanted === null || wanted.has(q.category)))
    .map(toGameQuestion);
}

const pickKey = (pack: string, category: string) => `${pack}\u0000${category}`;

/** Every category of every pack: what a new room starts with. */
export function allPicks(packs: Pack[]): Pick[] {
  return catalog(packs).flatMap((p) => p.categories.map((c) => ({ pack: p.id, category: c.name })));
}

/** Picks that name a category some pack really has. */
export function picksExist(picks: Pick[], packs: Pack[]): boolean {
  const known = new Set(allPicks(packs).map((p) => pickKey(p.pack, p.category)));
  return picks.every((p) => known.has(pickKey(p.pack, p.category)));
}

/** What the lobby shows: pack names and category sizes. Never includes answers. */
export function catalog(packs: Pack[]): PackInfo[] {
  return packs.map((p) => {
    const counts = new Map<string, number>();
    for (const q of p.questions) if (!q.hidden) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      categories: [...counts].map(([name, count]) => ({ name, count })),
    };
  });
}
