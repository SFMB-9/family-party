import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, MAX_PLAYERS, initialState, reduce } from "./reducer";
import type { Category, GameState, Player, Question, ReduceResult } from "./types";

// ---- helpers ----
const CATEGORIES: Category[] = [
  "general", "family", "geography", "history", "music", "cinema", "sports", "science",
];

let n = 0;
function q(category: Category): Question {
  const id = `q${n++}`;
  return {
    id, category,
    prompt: { text: id },
    response: { kind: "choice", options: ["A", "B", "C", "D"], correct: [0] },
    mode: "turn", difficulty: 1, timeLimitMs: null, stealable: true,
  };
}

const player = (id: string): Player => ({ id, name: id });

function ok(result: ReduceResult): GameState {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.state;
}

function lobbyWith(...ids: string[]): GameState {
  return ids.reduce((s, id) => ok(reduce(s, { type: "JOIN", player: player(id) })), initialState());
}

const bank = CATEGORIES.flatMap((c) => Array.from({ length: 4 }, () => q(c)));

// ---- JOIN ----
describe("JOIN", () => {
  it("adds the player with a score of 0", () => {
    const s = lobbyWith("ana");
    expect(s.players).toEqual([player("ana")]);
    expect(s.scores).toEqual({ ana: 0 });
  });

  it("keeps join order as turn order", () => {
    expect(lobbyWith("ana", "beto", "caro").players.map((p) => p.id)).toEqual(["ana", "beto", "caro"]);
  });

  it("rejects a duplicate id", () => {
    expect(reduce(lobbyWith("ana"), { type: "JOIN", player: player("ana") }))
      .toEqual({ ok: false, error: "ALREADY_JOINED" });
  });

  it(`rejects player #${MAX_PLAYERS + 1}`, () => {
    const full = lobbyWith(...Array.from({ length: MAX_PLAYERS }, (_, i) => `p${i}`));
    expect(reduce(full, { type: "JOIN", player: player("late") }))
      .toEqual({ ok: false, error: "ROOM_FULL" });
  });

  it("does not mutate the previous state", () => {
    const before = lobbyWith("ana");
    const snapshot = structuredClone(before);
    reduce(before, { type: "JOIN", player: player("beto") });
    expect(before).toEqual(snapshot);
  });
});

// ---- START ----
describe("START", () => {
  const start = (s: GameState, questions = bank, seed = 1) =>
    reduce(s, { type: "START", questions, seed });

  it("needs at least one player", () => {
    expect(start(initialState())).toEqual({ ok: false, error: "NOT_ENOUGH_PLAYERS" });
  });

  it("deals one row per player across five category columns", () => {
    const s = ok(start(lobbyWith("ana", "beto", "caro")));
    expect(s.board).toHaveLength(3 * BOARD_COLUMNS);
    expect(new Set(s.board.map((c) => c.category)).size).toBe(BOARD_COLUMNS);
  });

  it("only deals questions from the card's own category [Unity: categories ignored]", () => {
    const s = ok(start(lobbyWith("ana", "beto")));
    for (const card of s.board) {
      expect(s.questions[card.questionId]?.category).toBe(card.category);
    }
  });

  it("never deals the same question twice [Unity: duplicates]", () => {
    const s = ok(start(lobbyWith("ana", "beto", "caro", "dani")));
    const ids = s.board.map((c) => c.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips categories without enough questions for every player", () => {
    const thin = [...bank.filter((x) => x.category !== "music"), q("music")];
    const s = ok(start(lobbyWith("ana", "beto", "caro"), thin));
    expect(s.board.some((c) => c.category === "music")).toBe(false);
  });

  it("uses fewer columns when fewer categories qualify", () => {
    const twoCats = bank.filter((x) => x.category === "family" || x.category === "music");
    const s = ok(start(lobbyWith("ana", "beto"), twoCats));
    expect(new Set(s.board.map((c) => c.category)).size).toBe(2);
  });

  it("fails cleanly when no category qualifies [Unity: null question]", () => {
    expect(start(lobbyWith("ana", "beto"), [q("music")]))
      .toEqual({ ok: false, error: "NOT_ENOUGH_QUESTIONS" });
  });

  it("is deterministic for a seed", () => {
    const a = ok(start(lobbyWith("ana", "beto"), bank, 7));
    const b = ok(start(lobbyWith("ana", "beto"), bank, 7));
    expect(a.board).toEqual(b.board);
    expect(a.questions).toEqual(b.questions);
  });

  it("shuffles choices but keeps the correct answer", () => {
    const s = ok(start(lobbyWith("ana", "beto")));
    for (const question of Object.values(s.questions)) {
      const r = question.response;
      expect(r.correct.map((i) => r.options[i])).toEqual(["A"]);
    }
  });

  it("moves to picking with the first player's turn", () => {
    const s = ok(start(lobbyWith("ana", "beto")));
    expect(s.phase).toEqual({ kind: "picking" });
    expect(s.turnOwner).toBe(0);
  });

  it("cannot start twice", () => {
    const s = ok(start(lobbyWith("ana")));
    expect(start(s)).toEqual({ ok: false, error: "WRONG_PHASE" });
  });
    it("has exactly one card per row in each category column", () => {
    const s = ok(start(lobbyWith("ana", "beto", "caro")));
    const perCategory = new Map<string, number>();
    for (const c of s.board) perCategory.set(c.category, (perCategory.get(c.category) ?? 0) + 1);
    expect([...perCategory.values()]).toEqual(Array(BOARD_COLUMNS).fill(3));
  });

  it("deals different boards for different seeds", () => {
    const boards = [1, 2, 3, 4, 5].map((seed) =>
      JSON.stringify(ok(start(lobbyWith("ana", "beto"), bank, seed)).board));
    expect(new Set(boards).size).toBeGreaterThan(1);
  });

  it("actually shuffles the choices", () => {
    const s = ok(start(lobbyWith("ana", "beto", "caro")));
    const moved = Object.values(s.questions).some((x) => x.response.correct[0] !== 0);
    expect(moved).toBe(true);
  });

  it("only stores the questions that were dealt", () => {
    const s = ok(start(lobbyWith("ana")));
    expect(Object.keys(s.questions)).toHaveLength(s.board.length);
  });
});