/**
 * Converts the 2023 Unity QuestionBank.asset (a ScriptableObject saved as Unity YAML)
 * into a Pack. Used by scripts/import-unity.ts.
 *
 * Unity quirks handled here:
 *  - custom YAML tags ("%TAG !u!", "--- !u!114 &11400000") that standard parsers reject
 *  - accents escaped as "\xE1" inside double-quoted strings (valid YAML; the parser decodes them)
 *  - List<int> serialized as packed little-endian hex: "0300000001000000" → [3, 1]
 *  - categories stored as enum indexes (order of TriviaCategory in Enums.cs)
 */
import { parse } from "yaml";
import type { Difficulty } from "@family-party/game-core";
import type { Pack, PackQuestion } from "./pack";

/** Same order as `enum TriviaCategory` in the Unity project's Scripts/Enums.cs. */
export const UNITY_CATEGORIES = [
  "Cultura general", // GeneralKnowledge
  "Familia",         // Family
  "Geografía",       // Geography
  "Historia",        // History
  "Música",          // Music
  "Cine y TV",       // Cinema
  "Ciencia",         // Science
  "Reto",            // Challenge
] as const;

interface UnityQuestion {
  category?: number;
  number?: number;
  questionString?: string;
  answers?: string[];
  correctAnswers?: string | number;
  timeLimit?: number;
  points?: number;
  stealable?: number;
  difficulty?: number;
}

/** "0300000001000000" → [3, 1] (each int is 4 bytes, little-endian). */
export function decodeUnityIntList(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 <= hex.length; i += 8) {
    const bytes = hex.slice(i, i + 8).match(/../g)!.reverse().join("");
    out.push(parseInt(bytes, 16) | 0);
  }
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function importUnityAsset(text: string, meta: { id: string; name: string; description?: string }): Pack {
  // Drop Unity's tag directives and document header, keep the plain mapping underneath.
  const yamlText = text
    .split("\n")
    .filter((line) => !line.startsWith("%"))
    .map((line) => (line.startsWith("--- !u!") ? "---" : line))
    .join("\n");

  const doc = parse(yamlText) as { MonoBehaviour?: { questions?: UnityQuestion[] } };
  const raw = doc.MonoBehaviour?.questions ?? [];

  const questions: PackQuestion[] = raw.map((u, index) => {
    // A value like 00000000 can arrive as a number if the YAML parser reads it numerically.
    const hex = String(u.correctAnswers ?? "").padStart(8, "0");
    const timeLimit = u.timeLimit ?? 0;
    const q: PackQuestion = {
      id: `${meta.id}-unity-${u.number ?? index}`,
      category: UNITY_CATEGORIES[u.category ?? 0] ?? "Cultura general",
      text: (u.questionString ?? "").replace(/\s+/g, " ").trim(),
      options: (u.answers ?? []).map(String),
      correct: decodeUnityIntList(hex),
      difficulty: clamp(u.difficulty || 2, 1, 5) as Difficulty, // Unity used 0 for "unset"
      timeLimitSec: timeLimit > 0 ? clamp(timeLimit, 5, 120) : null,
      stealable: u.stealable !== 0,
    };
    if (u.points && u.points > 0) q.points = u.points;
    return q;
  });

  return { id: meta.id, name: meta.name, description: meta.description ?? "Importado de Unity.", questions };
}
