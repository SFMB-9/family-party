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

// ---- gameplay helpers ----
function game(ids: string[], questions = bank, seed = 1): GameState {
  return ok(reduce(lobbyWith(...ids), { type: "START", questions, seed }));
}
const questionOf = (s: GameState, cardId: string) =>
  s.questions[s.board.find((c) => c.id === cardId)!.questionId]!;
const right = (s: GameState, cardId: string) => questionOf(s, cardId).response.correct[0]!;
const wrong = (s: GameState, cardId: string) =>
  [0, 1, 2, 3].find((i) => !questionOf(s, cardId).response.correct.includes(i))!;

const pick = (s: GameState, playerId: string, cardId: string, at = 0) =>
  reduce(s, { type: "PICK_CARD", playerId, cardId, at });
const answer = (s: GameState, playerId: string, choice: number, at = 0) =>
  reduce(s, { type: "ANSWER", playerId, choice, at });

// ---- PICK_CARD ----
describe("PICK_CARD", () => {
  it("opens the card for the turn owner", () => {
    const g = game(["ana", "beto"]);
    const card = g.board[0]!;
    const s = ok(pick(g, "ana", card.id));
    expect(s.phase).toEqual({
      kind: "answering", cardId: card.id, answerer: "ana", stake: 100, deadline: null, tried: [],
    });
  });

  it("uses the points override as the stake", () => {
    const g = game(["ana"], bank.map((x) => ({ ...x, points: 250 })));
    const s = ok(pick(g, "ana", g.board[0]!.id));
    expect(s.phase.kind === "answering" && s.phase.stake).toBe(250);
  });

  it("sets a deadline for timed questions", () => {
    const g = game(["ana"], bank.map((x) => ({ ...x, timeLimitMs: 20_000 })));
    const s = ok(pick(g, "ana", g.board[0]!.id, 1_000));
    expect(s.phase.kind === "answering" && s.phase.deadline).toBe(21_000);
  });

  it("rejects a player out of turn", () => {
    const g = game(["ana", "beto"]);
    expect(pick(g, "beto", g.board[0]!.id)).toEqual({ ok: false, error: "NOT_YOUR_TURN" });
  });

  it("rejects an unknown card", () => {
    expect(pick(game(["ana"]), "ana", "nope")).toEqual({ ok: false, error: "UNKNOWN_CARD" });
  });

  it("rejects a card that was already played", () => {
    const g = game(["ana"]);
    const id = g.board[0]!.id;
    const done = ok(answer(ok(pick(g, "ana", id)), "ana", right(g, id)));
    expect(pick(done, "ana", id)).toEqual({ ok: false, error: "CARD_ALREADY_PLAYED" });
  });
});

// ---- ANSWER ----
describe("ANSWER", () => {
  const opened = (ids = ["ana", "beto", "caro"], questions = bank) => {
    const g = game(ids, questions);
    const id = g.board[0]!.id;
    return { s: ok(pick(g, "ana", id)), id };
  };

  it("a right answer scores the stake and passes the turn", () => {
    const { s, id } = opened();
    const next = ok(answer(s, "ana", right(s, id)));
    expect(next.scores.ana).toBe(100);
    expect(next.board.find((c) => c.id === id)!.played).toBe(true);
    expect(next.phase).toEqual({ kind: "picking" });
    expect(next.turnOwner).toBe(1);
  });

  it("a wrong answer costs the stake and opens a steal at half value", () => {
    const { s, id } = opened();
    const next = ok(answer(s, "ana", wrong(s, id)));
    expect(next.scores.ana).toBe(-100);
    expect(next.phase).toMatchObject({ kind: "answering", answerer: "beto", stake: 50, tried: ["ana"] });
  });

  it("after a steal, the turn continues from the owner [Unity: steal skips a turn]", () => {
    const { s, id } = opened();
    const s1 = ok(answer(s, "ana", wrong(s, id)));    // ana misses
    const s2 = ok(answer(s1, "beto", wrong(s, id)));  // beto misses the steal
    const s3 = ok(answer(s2, "caro", right(s, id)));  // caro steals it
    expect(s3.scores).toEqual({ ana: -100, beto: -50, caro: 25 });
    expect(s3.turnOwner).toBe(1);                     // beto's turn, not ana's
  });

  it("closes the card when nobody gets it", () => {
    const { s, id } = opened();
    const s1 = ok(answer(s, "ana", wrong(s, id)));
    const s2 = ok(answer(s1, "beto", wrong(s, id)));
    const s3 = ok(answer(s2, "caro", wrong(s, id)));
    expect(s3.scores).toEqual({ ana: -100, beto: -50, caro: -25 });
    expect(s3.phase).toEqual({ kind: "picking" });
    expect(s3.turnOwner).toBe(1);
  });

  it("a non-stealable question closes on the first miss", () => {
    const { s, id } = opened(["ana", "beto"], bank.map((x) => ({ ...x, stealable: false })));
    const next = ok(answer(s, "ana", wrong(s, id)));
    expect(next.phase).toEqual({ kind: "picking" });
  });

  it("only the current answerer may answer", () => {
    const { s, id } = opened();
    expect(answer(s, "beto", right(s, id))).toEqual({ ok: false, error: "NOT_YOUR_TURN" });
  });

  it("rejects malformed answers", () => {
    const { s } = opened();
    expect(answer(s, "ana", 99)).toEqual({ ok: false, error: "INVALID_ANSWER" });
  });

  it("rejects answers after the deadline", () => {
    const { s, id } = opened(["ana"], bank.map((x) => ({ ...x, timeLimitMs: 10_000 })));
    expect(answer(s, "ana", right(s, id), 10_001)).toEqual({ ok: false, error: "TOO_LATE" });
  });

  it("ends the game when the last card closes", () => {
    let s = game(["ana"]);
    for (const card of s.board) {
      s = ok(pick(s, "ana", card.id));
      s = ok(answer(s, "ana", right(s, card.id)));
    }
    expect(s.phase).toEqual({ kind: "gameOver" });
    expect(s.scores.ana).toBe(100 * s.board.length);
  });
});

describe("PICK_CARD (does nothing else)", () => {
  it("doesn't touch scores, board or turn when opening a card", () => {
    const g = game(["ana", "beto"]);
    const s = ok(pick(g, "ana", g.board[0]!.id));
    expect(s.scores).toEqual(g.scores);
    expect(s.board).toEqual(g.board);
    expect(s.turnOwner).toBe(g.turnOwner);
  });
});

// ---- TIMEOUT ----
describe("TIMEOUT", () => {
  const timed = bank.map((x) => ({ ...x, timeLimitMs: 10_000 }));
  const timeout = (s: GameState, at: number) => reduce(s, { type: "TIMEOUT", at });

  const opened = (ids = ["ana", "beto", "caro"]) => {
    const g = game(ids, timed);
    const id = g.board[0]!.id;
    return { s: ok(pick(g, "ana", id, 0)), id };
  };

  it("costs no points and opens a steal at half value, with a fresh deadline", () => {
    const { s } = opened();
    const next = ok(timeout(s, 10_000));
    expect(next.scores.ana).toBe(0);
    expect(next.phase).toMatchObject({
      kind: "answering", answerer: "beto", stake: 50, tried: ["ana"], deadline: 20_000,
    });
  });

  it("is rejected before the deadline", () => {
    const { s } = opened();
    expect(timeout(s, 9_999)).toEqual({ ok: false, error: "TOO_EARLY" });
  });

  it("doesn't apply to untimed questions", () => {
    const g = game(["ana", "beto"]);
    const s = ok(pick(g, "ana", g.board[0]!.id));
    expect(timeout(s, 999_999)).toEqual({ ok: false, error: "WRONG_PHASE" });
  });

  it("closes the card when the last stealer times out, and passes the turn from the owner", () => {
    const { s } = opened();
    const s1 = ok(timeout(s, 10_000));   // ana
    const s2 = ok(timeout(s1, 20_000));  // beto
    const s3 = ok(timeout(s2, 30_000));  // caro
    expect(s3.phase).toEqual({ kind: "picking" });
    expect(s3.turnOwner).toBe(1);
  });

  it("answer and timeout never overlap: at the deadline, only TIMEOUT is valid", () => {
    const { s, id } = opened();
    expect(answer(s, "ana", right(s, id), 10_000)).toEqual({ ok: false, error: "TOO_LATE" });
    expect(timeout(s, 10_000).ok).toBe(true);
  });
});

// ---- LEAVE ----
describe("LEAVE", () => {
  const leave = (s: GameState, playerId: string) => reduce(s, { type: "LEAVE", playerId });

  it("removes the player and their score in the lobby", () => {
    const s = ok(leave(lobbyWith("ana", "beto"), "ana"));
    expect(s.players.map((p) => p.id)).toEqual(["beto"]);
    expect(s.scores).toEqual({ beto: 0 });
  });

  it("rejects an unknown player", () => {
    expect(leave(lobbyWith("ana"), "zoe")).toEqual({ ok: false, error: "UNKNOWN_PLAYER" });
  });

  it("is lobby-only for now (mid-game leaving comes with reconnection)", () => {
    expect(leave(game(["ana", "beto"]), "ana")).toEqual({ ok: false, error: "WRONG_PHASE" });
  });
});

// ---- RATE ----
describe("RATE", () => {
  const rate = (s: GameState, playerId: string, questionId: string, difficulty: number) =>
    reduce(s, { type: "RATE", playerId, questionId, difficulty: difficulty as 1 });

  const afterOneAnswer = () => {
    const g = game(["ana", "beto"]);
    const id = g.board[0]!.id;
    const s = ok(answer(ok(pick(g, "ana", id)), "ana", right(g, id)));
    return { s, questionId: questionOf(s, id).id };
  };

  it("records who tried each question and whether they got it right", () => {
    const { s, questionId } = afterOneAnswer();
    expect(s.attempts[questionId]).toEqual({ ana: true });
  });

  it("stores a rating from someone who tried the question", () => {
    const { s, questionId } = afterOneAnswer();
    const next = ok(rate(s, "ana", questionId, 4));
    expect(next.ratings[questionId]).toEqual({ ana: 4 });
  });

  it("lets a player change their rating", () => {
    const { s, questionId } = afterOneAnswer();
    const next = ok(rate(ok(rate(s, "ana", questionId, 4)), "ana", questionId, 2));
    expect(next.ratings[questionId]).toEqual({ ana: 2 });
  });

  it("rejects ratings from players who haven't tried it", () => {
    const { s, questionId } = afterOneAnswer();
    expect(rate(s, "beto", questionId, 3)).toEqual({ ok: false, error: "NOT_ANSWERED_YET" });
  });

  it.each([0, 6, 2.5])("rejects a rating of %s", (bad) => {
    const { s, questionId } = afterOneAnswer();
    expect(rate(s, "ana", questionId, bad)).toEqual({ ok: false, error: "INVALID_RATING" });
  });

  it("never changes scores", () => {
    const { s, questionId } = afterOneAnswer();
    expect(ok(rate(s, "ana", questionId, 5)).scores).toEqual(s.scores);
  });
});
