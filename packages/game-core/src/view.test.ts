import { describe, expect, it } from "vitest";
import { initialState, reduce } from "./reducer";
import { publicView, rankings } from "./view";
import type { GameState, Question, ReduceResult } from "./types";

function ok(r: ReduceResult): GameState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const bank: Question[] = ["family", "music"].flatMap((category, c) =>
  [0, 1, 2].map((i) => ({
    id: `${category}${i}`,
    category: category as Question["category"],
    prompt: { text: `Pregunta ${c}-${i}` },
    response: { kind: "choice" as const, options: ["A", "B", "C"], correct: [1] },
    mode: "turn" as const,
    difficulty: 2 as const,
    timeLimitMs: null,
    stealable: true,
  })),
);

function playing(): GameState {
  let s = initialState();
  for (const id of ["ana", "beto"]) s = ok(reduce(s, { type: "JOIN", player: { id, name: id } }));
  return ok(reduce(s, { type: "START", questions: bank, seed: 3 }));
}

describe("publicView", () => {
  it("never contains a correct answer anywhere", () => {
    const g = playing();
    const s = ok(reduce(g, { type: "PICK_CARD", playerId: "ana", cardId: g.board[0]!.id, at: 0 }));
    expect(JSON.stringify(publicView(s))).not.toContain("correct");
  });

  it("shows only the question currently open", () => {
    const g = playing();
    expect(publicView(g).current).toBeNull();

    const card = g.board[0]!;
    const s = ok(reduce(g, { type: "PICK_CARD", playerId: "ana", cardId: card.id, at: 0 }));
    const view = publicView(s);
    expect(view.current?.id).toBe(card.questionId);
    expect(view.current?.response.options).toHaveLength(3);
  });

  it("doesn't leak upcoming questions", () => {
    const g = playing();
    const text = JSON.stringify(publicView(g));
    for (const q of bank) expect(text).not.toContain(q.prompt.text);
  });
});

describe("rankings", () => {
  const withScores = (scores: Record<string, number>): GameState => ({
    ...initialState(),
    players: Object.keys(scores).map((id) => ({ id, name: id })),
    scores,
  });

  it("orders by score, highest first", () => {
    const r = rankings(withScores({ ana: 100, beto: 300, caro: 200 }));
    expect(r.map((x) => x.player.id)).toEqual(["beto", "caro", "ana"]);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it("gives tied players the same rank and skips the next one", () => {
    const r = rankings(withScores({ ana: 200, beto: 200, caro: 100 }));
    expect(r.map((x) => x.rank)).toEqual([1, 1, 3]);
  });

  it("handles negative scores", () => {
    const r = rankings(withScores({ ana: -100, beto: 0 }));
    expect(r.map((x) => x.player.id)).toEqual(["beto", "ana"]);
  });
});
