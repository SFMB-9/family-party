import { choiceHandler } from "./handlers/choice";
import type { GameState, PublicState, Ranking } from "./types";

/**
 * The only shape that ever leaves the server.
 *
 * Full state holds every dealt question with its correct answers. Sending
 * that to phones would let anyone with DevTools read the answers (and
 * google upcoming questions). Clients get the board, the scores and only
 * the question currently open, with its answer stripped.
 */
export function publicView(state: GameState): PublicState {
  let current: PublicState["current"] = null;

  if (state.phase.kind === "answering") {
    const { cardId } = state.phase;
    const card = state.board.find((c) => c.id === cardId)!;
    const q = state.questions[card.questionId]!;
    current = {
      id: q.id,
      category: q.category,
      prompt: q.prompt,
      response: choiceHandler.redact(q.response),
      mode: q.mode,
      difficulty: q.difficulty,
      ...(q.points !== undefined && { points: q.points }),
      timeLimitMs: q.timeLimitMs,
      stealable: q.stealable,
    };
  }

  return {
    players: state.players,
    scores: state.scores,
    board: state.board,
    turnOwner: state.turnOwner,
    phase: state.phase,
    current,
  };
}

/** Highest score first. Ties share a rank (1, 1, 3), unlike the Unity version. */
export function rankings(state: GameState): Ranking[] {
  const sorted = [...state.players]
    .map((player) => ({ player, score: state.scores[player.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  // A player's rank is 1 + the position of the first player with the same score.
  return sorted.map((entry) => ({
    ...entry,
    rank: sorted.findIndex((e) => e.score === entry.score) + 1,
  }));
}
