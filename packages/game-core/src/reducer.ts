import { createRng, shuffle } from "./random";
import { choiceHandler } from "./handlers/choice";
import type { Action, Card, Category, GameError, GameState, Question, ReduceResult } from "./types";

export const MAX_PLAYERS = 10;    // same as Unity
export const BOARD_COLUMNS = 5;   // categories per board

export function initialState(): GameState {
  return {
    players: [], scores: {}, board: [], questions: {}, ratings: {},
    turnOwner: 0, phase: { kind: "lobby" }, seed: 0,
  };
}

const fail = (error: GameError): ReduceResult => ({ ok: false, error });

export function reduce(state: GameState, action: Action): ReduceResult {
  switch (action.type) {
    case "JOIN":  return join(state, action);
    case "START": return start(state, action);
    default: throw new Error(`${action.type} not implemented yet`);
  }
}

function join(state: GameState, action: Extract<Action, { type: "JOIN" }>): ReduceResult {
  if (state.phase.kind !== "lobby") {
    return fail("WRONG_PHASE");
  }
  if (state.players.some((p) => p.id === action.player.id)) {
    return fail("ALREADY_JOINED");
  }
  if (state.players.length >= MAX_PLAYERS) {
    return fail("ROOM_FULL");
  }
  const players = [...state.players, action.player];
  const scores = { ...state.scores, [action.player.id]: 0 };
  return { ok: true, state: { ...state, players, scores } };
}

function start(state: GameState, action: Extract<Action, { type: "START" }>): ReduceResult {
  // Guards
  if (state.phase.kind !== "lobby") return fail("WRONG_PHASE");  
  if (state.players.length < 1) return fail("NOT_ENOUGH_PLAYERS");

  const rows = state.players.length;
  const rng = createRng(action.seed);

  // Group the bank by category
  const byCategory = new Map<Category, Question[]>();
  for (const q of action.questions) {
    const list = byCategory.get(q.category) ?? [];
    list.push(q);
    byCategory.set(q.category, list);
  }

  // Keep categories that can fill a whole column (one card per player)
  const qualifying = [...byCategory.keys()]
    .filter((c) => (byCategory.get(c)!.length >= rows))
    .sort();

  // Pick up to 5 columns at random
  const columns = shuffle(qualifying, rng).slice(0, BOARD_COLUMNS);
  if (columns.length === 0) return fail("NOT_ENOUGH_QUESTIONS");

  // Fill each column with distinct questions, shuffling their choices
  const board: Card[] = [];
  const questions: Record<string, Question> = {};

  for (const category of columns) {
    const picked = shuffle(byCategory.get(category)!, rng).slice(0, rows);
    picked.forEach((q, row) => {
      questions[q.id] = { ...q, response: choiceHandler.prepare(q.response, rng) };
      board.push({ id: `${category}-${row}`, category, questionId: q.id, played: false });
    });
  }

  // New state: never mutate the old one
  return {
    ok: true,
    state: { ...state, board, questions, phase: { kind: "picking" }, seed: action.seed },
  };
}