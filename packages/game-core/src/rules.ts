import type { Rules } from "./types";

/**
 * House rules the host picks in the lobby. The defaults are the 2023 game:
 * wrong answers cost the stake, steals halve it, every card in its category column.
 */
export const DEFAULT_RULES: Rules = {
  wrongAnswer: "lose",
  timer: "question",
  steals: "half",
  stealTime: "fresh",
  columns: 5,
  rows: "players",
  mixed: false,
};

export const RULE_LIMITS = {
  columns: { min: 3, max: 5 },
  rows: { min: 1, max: 8 },
  timerSeconds: [15, 20, 30] as const,
  /** A steal never starts with less than this, even when inheriting a nearly-expired timer. */
  minStealMs: 5_000,
} as const;

const oneOf = <T>(value: unknown, options: readonly T[]): value is T => options.includes(value as T);
const intIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/**
 * Merge a partial update into the current rules. Returns null if any field is invalid:
 * all or nothing, so a bad field can't half-apply.
 */
export function applyRules(current: Rules, patch: Partial<Record<keyof Rules, unknown>>): Rules | null {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    switch (key as keyof Rules) {
      case "wrongAnswer":
        if (!oneOf(value, ["lose", "keep", "floor"] as const)) return null;
        next.wrongAnswer = value;
        break;
      case "timer":
        if (!(value === "question" || value === "off" || oneOf(value, RULE_LIMITS.timerSeconds))) return null;
        next.timer = value;
        break;
      case "steals":
        if (!oneOf(value, ["off", "half", "full"] as const)) return null;
        next.steals = value;
        break;
      case "stealTime":
        if (!oneOf(value, ["fresh", "remaining", "half"] as const)) return null;
        next.stealTime = value;
        break;
      case "columns":
        if (!intIn(value, RULE_LIMITS.columns.min, RULE_LIMITS.columns.max)) return null;
        next.columns = value;
        break;
      case "rows":
        if (!(value === "players" || intIn(value, RULE_LIMITS.rows.min, RULE_LIMITS.rows.max))) return null;
        next.rows = value;
        break;
      case "mixed":
        if (typeof value !== "boolean") return null;
        next.mixed = value;
        break;
      default:
        return null; // unknown option
    }
  }
  return next;
}

/** Cards per column for this many players. */
export const rowsFor = (rules: Rules, players: number) => (rules.rows === "players" ? players : rules.rows);
