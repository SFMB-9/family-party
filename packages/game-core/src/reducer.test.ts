import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, MAX_NAME_LENGTH, MAX_PLAYERS, initialState, reduce } from "./reducer";
import { DEFAULT_RULES } from "./rules";
import type { Rules } from "./types";
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

/** Join order as turn order, so tests can say who plays first. Random order has its own tests. */
function lobbyWith(...ids: string[]): GameState {
  const start: GameState = { ...initialState(), rules: { ...DEFAULT_RULES, order: "join" } };
  return ids.reduce((s, id) => ok(reduce(s, { type: "JOIN", player: player(id) })), start);
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

  it("stores the name trimmed, with inner spaces collapsed", () => {
    const s = ok(reduce(initialState(), { type: "JOIN", player: { id: "a", name: "  Ana   María " } }));
    expect(s.players[0]!.name).toBe("Ana María");
  });

  it.each(["", "   ", "x".repeat(MAX_NAME_LENGTH + 1)])("rejects the name %j", (name) => {
    expect(reduce(initialState(), { type: "JOIN", player: { id: "a", name } }))
      .toEqual({ ok: false, error: "INVALID_NAME" });
  });

  it("accepts a name exactly at the limit", () => {
    const name = "x".repeat(MAX_NAME_LENGTH);
    expect(reduce(initialState(), { type: "JOIN", player: { id: "a", name } }).ok).toBe(true);
  });

  it("counts an emoji as one character", () => {
    const name = "🎉".repeat(MAX_NAME_LENGTH);   // .length would be 40
    expect(reduce(initialState(), { type: "JOIN", player: { id: "a", name } }).ok).toBe(true);
  });

  it("rejects a non-string name from a misbehaving client", () => {
    const player = { id: "a", name: 42 } as unknown as Player;
    expect(reduce(initialState(), { type: "JOIN", player })).toEqual({ ok: false, error: "INVALID_NAME" });
  });

  it.each(["ana", "ANA", " Ana "])("treats %j as the same name as \"Ana\"", (name) => {
    const s = ok(reduce(initialState(), { type: "JOIN", player: { id: "a", name: "Ana" } }));
    expect(reduce(s, { type: "JOIN", player: { id: "b", name } }))
      .toEqual({ ok: false, error: "NAME_TAKEN" });
  });

  it("treats accented and unaccented spellings as the same name", () => {
    const s = ok(reduce(initialState(), { type: "JOIN", player: { id: "a", name: "José" } }));
    expect(reduce(s, { type: "JOIN", player: { id: "b", name: "Jose" } }))
      .toEqual({ ok: false, error: "NAME_TAKEN" });
  });

  it("does not mutate the previous state", () => {
    const before = lobbyWith("ana");
    const snapshot = structuredClone(before);
    reduce(before, { type: "JOIN", player: player("beto") });
    expect(before).toEqual(snapshot);
  });
});

// ---- START ----
describe("turn order", () => {
  const ids = (s: GameState) => s.players.map((p) => p.id);
  const randomLobby = (...names: string[]) =>
    names.reduce((s, id) => ok(reduce(s, { type: "JOIN", player: player(id) })), initialState());
  const names = ["ana", "beto", "caro", "dani"];   // the test bank fills 4 rows

  it("is drawn at random by default, a different order for different seeds", () => {
    const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) => ids(ok(reduce(randomLobby(...names), { type: "START", questions: bank, seed }))).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("keeps everyone, starts with whoever is first, and is the same for the same seed", () => {
    const a = ok(reduce(randomLobby(...names), { type: "START", questions: bank, seed: 7 }));
    const b = ok(reduce(randomLobby(...names), { type: "START", questions: bank, seed: 7 }));
    expect([...ids(a)].sort()).toEqual(names);
    expect(ids(a)).toEqual(ids(b));
    expect(a.turnOwner).toBe(0);
  });

  it("doesn't change the deal: same seed, same board, whichever order", () => {
    const random = ok(reduce(randomLobby(...names), { type: "START", questions: bank, seed: 3 }));
    const joined = ok(reduce(lobbyWith(...names), { type: "START", questions: bank, seed: 3 }));
    expect(random.board).toEqual(joined.board);
  });

  it("can stay in join order (house rule)", () => {
    const s = ok(reduce(lobbyWith(...names), { type: "START", questions: bank, seed: 9 }));
    expect(ids(s)).toEqual(names);
  });
});

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
      kind: "answering", cardId: card.id, answerer: "ana", stake: 100, deadline: null, tried: [], results: [],
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
  const leave = (s: GameState, playerId: string, at = 0) => reduce(s, { type: "LEAVE", playerId, at });
  const ids = (s: GameState) => s.players.map((p) => p.id);

  it("removes the player and their score in the lobby", () => {
    const s = ok(leave(lobbyWith("ana", "beto"), "ana"));
    expect(s.players.map((p) => p.id)).toEqual(["beto"]);
    expect(s.scores).toEqual({ beto: 0 });
  });

  it("rejects an unknown player", () => {
    expect(leave(lobbyWith("ana"), "zoe")).toEqual({ ok: false, error: "UNKNOWN_PLAYER" });
  });

  describe("mid-game", () => {
    it("keeps the seat and score for the podium but marks them as left", () => {
      const s = ok(leave(game(["ana", "beto", "caro"]), "beto"));
      expect(ids(s)).toEqual(["ana", "beto", "caro"]);
      expect(s.left).toEqual(["beto"]);
      expect(s.scores.beto).toBe(0);
    });

    it("passes the turn on if it was theirs to pick", () => {
      const s = ok(leave(game(["ana", "beto", "caro"]), "ana"));
      expect(s.turnOwner).toBe(1);
      expect(s.phase.kind).toBe("picking");
    });

    it("skips them when the turn comes around", () => {
      const g = ok(leave(game(["ana", "beto", "caro"]), "beto"));
      const id = g.board[0]!.id;
      const s = ok(answer(ok(pick(g, "ana", id)), "ana", right(g, id)));
      expect(s.players[s.turnOwner]!.id).toBe("caro");
    });

    it("plays out their open answer like a timeout: no points lost, the steal moves on", () => {
      const g = game(["ana", "beto", "caro"]);
      const id = g.board[0]!.id;
      const s = ok(leave(ok(pick(g, "ana", id, 1_000)), "ana", 2_000));
      expect(s.phase).toMatchObject({ kind: "answering", answerer: "beto", tried: ["ana"] });
      expect(s.scores.ana).toBe(0);
    });

    it("never hands them a steal", () => {
      const g = ok(leave(game(["ana", "beto", "caro"]), "beto"));
      const id = g.board[0]!.id;
      const s = ok(answer(ok(pick(g, "ana", id)), "ana", wrong(g, id)));
      expect(s.phase).toMatchObject({ kind: "answering", answerer: "caro" });
    });

    it("closes the card when the leaver was the last one who could answer", () => {
      const g = game(["ana", "beto"]);
      const id = g.board[0]!.id;
      const stealing = ok(answer(ok(pick(g, "ana", id)), "ana", wrong(g, id)));   // beto may steal
      const s = ok(leave(stealing, "beto", 5_000));
      expect(s.phase.kind).toBe("picking");
      expect(s.board.find((c) => c.id === id)!.played).toBe(true);
      expect(s.reveal).toMatchObject({ cardId: id, closedAt: 5_000 });
      expect(s.players[s.turnOwner]!.id).toBe("ana"); // the only one still playing
    });

    it("ends the game when everyone has left", () => {
      const s = ok(leave(ok(leave(game(["ana", "beto"]), "ana")), "beto"));
      expect(s.phase.kind).toBe("gameOver");
    });

    it("leaving twice is harmless", () => {
      const once = ok(leave(game(["ana", "beto", "caro"]), "beto"));
      expect(ok(leave(once, "beto"))).toEqual(once);
    });

    it("on the podium it withdraws their encore, and a rematch leaves them out", () => {
      let s = ok(reduce(game(["ana", "beto"]), { type: "END" }));
      s = ok(reduce(s, { type: "ENCORE", playerId: "beto" }));
      s = ok(leave(s, "beto"));
      expect(s.encore).toEqual([]);
      const lobby = ok(reduce(s, { type: "REMATCH", keep: ["ana", "beto"] }));
      expect(ids(lobby)).toEqual(["ana"]);
      expect(lobby.left).toEqual([]);
    });

    it("can't leave a closed room", () => {
      const closed = ok(reduce(lobbyWith("ana"), { type: "CLOSE" }));
      expect(leave(closed, "ana")).toEqual({ ok: false, error: "WRONG_PHASE" });
    });
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

// ---- REVEAL & CARD VALUES ----
describe("reveal", () => {
  const opened = (ids = ["ana", "beto", "caro"], questions = bank) => {
    const g = game(ids, questions);
    const id = g.board[0]!.id;
    return { s: ok(pick(g, "ana", id, 1_000)), id };
  };

  it("cards carry their value for the board", () => {
    const g = game(["ana"], bank.map((x) => ({ ...x, difficulty: 3 as const })));
    expect(g.board.every((c) => c.value === 300)).toBe(true);
  });

  it("starts empty", () => {
    expect(game(["ana"]).reveal).toBeNull();
  });

  it("records a right answer when the card closes", () => {
    const { s, id } = opened();
    const next = ok(answer(s, "ana", right(s, id), 2_000));
    expect(next.reveal).toEqual({
      cardId: id,
      questionId: questionOf(s, id).id,
      results: [{ playerId: "ana", choice: right(s, id), delta: 100 }],
      closedAt: 2_000,
    });
  });

  it("keeps every attempt across steals, including timeouts", () => {
    const timed = bank.map((x) => ({ ...x, timeLimitMs: 10_000 }));
    const { s, id } = opened(["ana", "beto", "caro"], timed);
    const s1 = ok(answer(s, "ana", wrong(s, id), 2_000));              // ana misses: -100
    const s2 = ok(reduce(s1, { type: "TIMEOUT", at: 12_000 }));        // beto times out: 0
    expect(s2.phase).toMatchObject({ results: [{ playerId: "ana", delta: -100 }, { playerId: "beto", choice: null, delta: 0 }] });
    const s3 = ok(answer(s2, "caro", right(s, id), 13_000));            // caro steals at a quarter: +25
    expect(s3.reveal?.results).toEqual([
      { playerId: "ana", choice: wrong(s, id), delta: -100 },
      { playerId: "beto", choice: null, delta: 0 },
      { playerId: "caro", choice: right(s, id), delta: 25 },
    ]);
    expect(s3.reveal?.closedAt).toBe(13_000);
  });

  it("is replaced by the next card's reveal", () => {
    let s = game(["ana"]);
    const [a, b] = s.board;
    s = ok(answer(ok(pick(s, "ana", a!.id)), "ana", right(s, a!.id), 1));
    s = ok(answer(ok(pick(s, "ana", b!.id)), "ana", right(s, b!.id), 2));
    expect(s.reveal?.cardId).toBe(b!.id);
  });
});

// ---- END ----
describe("END", () => {
  it("goes straight to the podium from the board, keeping scores", () => {
    const g = game(["ana", "beto"]);
    const id = g.board[0]!.id;
    const scored = ok(answer(ok(pick(g, "ana", id, 1_000)), "ana", right(g, id), 2_000));
    const s = ok(reduce(scored, { type: "END" }));
    expect(s.phase).toEqual({ kind: "gameOver" });
    expect(s.scores).toEqual(scored.scores);
    expect(s.reveal).toBeNull();                       // no reveal hiding the podium
  });

  it("drops an open card unscored", () => {
    const g = game(["ana", "beto"]);
    const id = g.board[0]!.id;
    const s = ok(reduce(ok(pick(g, "ana", id, 1_000)), { type: "END" }));
    expect(s.phase).toEqual({ kind: "gameOver" });
    expect(s.scores).toEqual({ ana: 0, beto: 0 });
  });

  it("only while playing", () => {
    expect(reduce(lobbyWith("ana"), { type: "END" })).toEqual({ ok: false, error: "WRONG_PHASE" });
    const over = ok(reduce(game(["ana"]), { type: "END" }));
    expect(reduce(over, { type: "END" })).toEqual({ ok: false, error: "WRONG_PHASE" });
  });
});

// ---- after the game: ENCORE / REMATCH / CLOSE ----
describe("after the game", () => {
  /** Plays every card (always the right answer) until the podium. */
  function finished(ids = ["ana", "beto"], questions = bank): GameState {
    let s = game(ids, questions);
    while (s.phase.kind !== "gameOver") {
      const owner = s.players[s.turnOwner]!.id;
      const card = s.board.find((c) => !c.played)!;
      s = ok(pick(s, owner, card.id, 1_000));
      s = ok(answer(s, owner, right(s, card.id), 2_000));
    }
    return s;
  }

  it("ENCORE collects players who want another round, once each", () => {
    let s = finished();
    s = ok(reduce(s, { type: "ENCORE", playerId: "beto" }));
    s = ok(reduce(s, { type: "ENCORE", playerId: "beto" }));
    expect(s.encore).toEqual(["beto"]);
    expect(reduce(s, { type: "ENCORE", playerId: "zoe" })).toEqual({ ok: false, error: "UNKNOWN_PLAYER" });
  });

  it("ENCORE only on the podium", () => {
    expect(reduce(game(["ana"]), { type: "ENCORE", playerId: "ana" })).toEqual({ ok: false, error: "WRONG_PHASE" });
  });

  it("REMATCH goes back to the lobby with the kept players at 0", () => {
    const over = ok(reduce(finished(["ana", "beto", "caro"]), { type: "ENCORE", playerId: "ana" }));
    const s = ok(reduce(over, { type: "REMATCH", keep: ["caro", "ana"] }));
    expect(s.phase).toEqual({ kind: "lobby" });
    expect(s.players.map((p) => p.id)).toEqual(["ana", "caro"]);   // join order kept, beto went home
    expect(s.scores).toEqual({ ana: 0, caro: 0 });
    expect(s.board).toEqual([]);
    expect(s.reveal).toBeNull();
    expect(s.encore).toEqual([]);
  });

  it("the next round deals questions nobody has played yet", () => {
    const first = finished(["ana", "beto"]);
    const firstIds = new Set(first.board.map((c) => c.questionId));
    const lobby = ok(reduce(first, { type: "REMATCH", keep: ["ana", "beto"] }));
    expect(new Set(lobby.played)).toEqual(firstIds);

    const second = ok(reduce(lobby, { type: "START", questions: bank, seed: 1 }));   // same seed on purpose
    expect(second.board.some((c) => firstIds.has(c.questionId))).toBe(false);
  });

  it("repeats only top up when a category runs out", () => {
    const small = CATEGORIES.slice(0, 5).flatMap((c) => [q(c), q(c), q(c)]); // 3 per category, 2 players
    const lobby = ok(reduce(finished(["ana", "beto"], small), { type: "REMATCH", keep: ["ana", "beto"] }));
    const second = ok(reduce(lobby, { type: "START", questions: small, seed: 2 }));
    for (const category of new Set(second.board.map((c) => c.category))) {
      const ids = second.board.filter((c) => c.category === category).map((c) => c.questionId);
      expect(ids.filter((id) => !lobby.played.includes(id))).toHaveLength(1);   // the one fresh question is used
    }
  });

  it("REMATCH only from the podium", () => {
    expect(reduce(game(["ana"]), { type: "REMATCH", keep: ["ana"] })).toEqual({ ok: false, error: "WRONG_PHASE" });
  });

  it("CLOSE works from any phase, once", () => {
    for (const s of [lobbyWith("ana"), game(["ana"]), finished()]) {
      expect(ok(reduce(s, { type: "CLOSE" })).phase).toEqual({ kind: "closed" });
    }
    const closed = ok(reduce(lobbyWith("ana"), { type: "CLOSE" }));
    expect(reduce(closed, { type: "CLOSE" })).toEqual({ ok: false, error: "WRONG_PHASE" });
    expect(reduce(closed, { type: "JOIN", player: player("late") })).toEqual({ ok: false, error: "WRONG_PHASE" });
  });
});

// ---- house rules ----
describe("rules", () => {
  const timed = bank.map((x) => ({ ...x, timeLimitMs: 20_000 }));
  /** Lobby with these rules, then START. */
  function withRules(rules: Partial<Rules>, ids = ["ana", "beto", "caro"], questions = timed, seed = 1): GameState {
    const lobby = ok(reduce(lobbyWith(...ids), { type: "SET_RULES", rules }));
    return ok(reduce(lobby, { type: "START", questions, seed }));
  }
  const openFirst = (s: GameState, at = 1_000) => {
    const id = s.board[0]!.id;
    return { s: ok(pick(s, s.players[s.turnOwner]!.id, id, at)), id };
  };

  describe("SET_RULES", () => {
    it("merges a partial change into the defaults", () => {
      const s = ok(reduce(initialState(), { type: "SET_RULES", rules: { steals: "full", columns: 3 } }));
      expect(s.rules).toEqual({ ...DEFAULT_RULES, steals: "full", columns: 3 });
    });

    it.each([
      { columns: 6 }, { columns: 2.5 }, { rows: 0 }, { rows: 9 }, { timer: 17 }, { wrongAnswer: "maybe" }, { order: "alphabetical" },
      { mixed: "yes" }, { unknownOption: true }, { steals: "half", columns: 99 },   // all or nothing
    ])("rejects %j", (rules) => {
      expect(reduce(lobbyWith("ana"), { type: "SET_RULES", rules })).toEqual({ ok: false, error: "INVALID_RULES" });
    });

    it("only in the lobby", () => {
      expect(reduce(game(["ana"]), { type: "SET_RULES", rules: { columns: 3 } })).toEqual({ ok: false, error: "WRONG_PHASE" });
    });

    it("survive a rematch", () => {
      let s = withRules({ steals: "off" }, ["ana"]);
      s = ok(reduce(s, { type: "END" }));
      s = ok(reduce(s, { type: "REMATCH", keep: ["ana"] }));
      expect(s.rules.steals).toBe("off");
    });
  });

  describe("board", () => {
    it("uses the chosen number of columns and a fixed number of rows", () => {
      const s = withRules({ columns: 3, rows: 2 });
      expect(new Set(s.board.map((c) => c.category)).size).toBe(3);
      expect(s.board).toHaveLength(6);
      expect(s.board.map((c) => c.column)).toEqual([0, 0, 1, 1, 2, 2]);
    });

    it("rows: 'players' deals one card per player per column", () => {
      expect(withRules({ columns: 4 }, ["ana", "beto"]).board).toHaveLength(8);
    });

    it("mixed: a columns × rows grid of any categories", () => {
      const s = withRules({ mixed: true, columns: 4, rows: 3 });
      expect(s.board).toHaveLength(12);
      expect(new Set(s.board.map((c) => c.questionId)).size).toBe(12);
      expect(s.board.filter((c) => c.column === 0)).toHaveLength(3);
      expect(new Set(s.board.map((c) => c.category)).size).toBeGreaterThan(1);
    });

    it("mixed works with a pack that has a single category", () => {
      const one = Array.from({ length: 10 }, () => ({ ...q("solo"), timeLimitMs: 20_000 }));
      expect(withRules({ mixed: true, columns: 3, rows: 3 }, ["ana"], one).board).toHaveLength(9);
    });
  });

  describe("wrong answers", () => {
    const missOnce = (rules: Partial<Rules>) => {
      const { s, id } = openFirst(withRules(rules));
      return ok(answer(s, "ana", wrong(s, id), 2_000));
    };

    it("lose (default): the stake comes off, even below zero", () => {
      expect(missOnce({}).scores.ana).toBe(-100);
    });

    it("keep: no penalty", () => {
      expect(missOnce({ wrongAnswer: "keep" }).scores.ana).toBe(0);
    });

    it("floor: never below $0", () => {
      expect(missOnce({ wrongAnswer: "floor" }).scores.ana).toBe(0);
      const s = missOnce({ wrongAnswer: "floor" });
      expect(s.phase.kind === "answering" && s.phase.results[0]!.delta).toBe(0);
    });
  });

  describe("steals", () => {
    it("off: a miss closes the card", () => {
      const { s, id } = openFirst(withRules({ steals: "off" }));
      expect(ok(answer(s, "ana", wrong(s, id), 2_000)).phase.kind).toBe("picking");
    });

    it("full: the stealer plays for the whole value", () => {
      const { s, id } = openFirst(withRules({ steals: "full" }));
      expect(ok(answer(s, "ana", wrong(s, id), 2_000)).phase).toMatchObject({ answerer: "beto", stake: 100 });
    });

    it("half (default) halves each time", () => {
      const { s, id } = openFirst(withRules({}));
      expect(ok(answer(s, "ana", wrong(s, id), 2_000)).phase).toMatchObject({ stake: 50 });
    });
  });

  describe("timer", () => {
    it("a fixed timer overrides each question's own", () => {
      const { s } = openFirst(withRules({ timer: 15 }));
      expect(s.phase).toMatchObject({ deadline: 16_000 });
    });

    it("off: no deadline, so no timeouts", () => {
      const { s } = openFirst(withRules({ timer: "off" }));
      expect(s.phase).toMatchObject({ deadline: null });
      expect(reduce(s, { type: "TIMEOUT", at: 999_999 })).toEqual({ ok: false, error: "WRONG_PHASE" });
    });

    it("stealTime fresh (default): a full new timer", () => {
      const { s, id } = openFirst(withRules({}));
      expect(ok(answer(s, "ana", wrong(s, id), 6_000)).phase).toMatchObject({ deadline: 26_000 });
    });

    it("stealTime remaining: inherits what was left", () => {
      const { s, id } = openFirst(withRules({ stealTime: "remaining" }));     // deadline 21_000
      expect(ok(answer(s, "ana", wrong(s, id), 6_000)).phase).toMatchObject({ deadline: 21_000 });
    });

    it("stealTime remaining after a timeout still gives the floor (5 s)", () => {
      const { s } = openFirst(withRules({ stealTime: "remaining" }));
      expect(ok(reduce(s, { type: "TIMEOUT", at: 21_000 })).phase).toMatchObject({ deadline: 26_000 });
    });

    it("stealTime half: half a timer", () => {
      const { s, id } = openFirst(withRules({ stealTime: "half" }));
      expect(ok(answer(s, "ana", wrong(s, id), 6_000)).phase).toMatchObject({ deadline: 16_000 });
    });
  });
});

// ---- picks ----
describe("SET_PICKS", () => {
  const pick = (category: string, pack = "clasico") => ({ pack, category });

  it("stores the picked categories (lobby only), and they survive a rematch", () => {
    let s = ok(reduce(lobbyWith("ana"), { type: "SET_PICKS", picks: [pick("Historia"), pick("Viajes", "familia")] }));
    expect(s.picks).toEqual([pick("Historia"), pick("Viajes", "familia")]);
    s = ok(reduce(s, { type: "START", questions: bank, seed: 1 }));
    expect(reduce(s, { type: "SET_PICKS", picks: [pick("Ciencia")] })).toEqual({ ok: false, error: "WRONG_PHASE" });
    s = ok(reduce(ok(reduce(s, { type: "END" })), { type: "REMATCH", keep: ["ana"] }));
    expect(s.picks).toHaveLength(2);
  });

  it("the same category name in two packs is two different picks", () => {
    const s = ok(reduce(lobbyWith("ana"), { type: "SET_PICKS", picks: [pick("Historia"), pick("Historia", "familia")] }));
    expect(s.picks).toHaveLength(2);
  });

  it.each([
    { name: "empty", picks: [] },
    { name: "duplicates", picks: [pick("Historia"), pick("Historia")] },
    { name: "too many", picks: Array.from({ length: 61 }, (_, i) => pick(`c${i}`)) },
  ])("rejects $name", ({ picks }) => {
    expect(reduce(lobbyWith("ana"), { type: "SET_PICKS", picks })).toEqual({ ok: false, error: "INVALID_PICKS" });
  });

  it("strips anything extra the caller attached", () => {
    const sneaky = { pack: "clasico", category: "Historia", correct: [0] } as ReturnType<typeof pick>;
    expect(ok(reduce(lobbyWith("ana"), { type: "SET_PICKS", picks: [sneaky] })).picks).toEqual([pick("Historia")]);
  });
});
