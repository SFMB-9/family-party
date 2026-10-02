import { createRng, shuffle } from "./random";
import { choiceHandler } from "./handlers/choice";
import type {
  Action, Card, Category, Difficulty, GameError, GameState, Phase, PlayerId, Question, ReduceResult,
} from "./types";

export const MAX_PLAYERS = 10;    // same as Unity
export const BOARD_COLUMNS = 5;   // categories per board
export const MAX_NAME_LENGTH = 20;

export function initialState(): GameState {
  return {
    players: [], scores: {}, board: [], questions: {}, ratings: {}, attempts: {},
    turnOwner: 0, phase: { kind: "lobby" }, seed: 0,
  };
}

const fail = (error: GameError): ReduceResult => ({ ok: false, error });
const done = (state: GameState): ReduceResult => ({ ok: true, state });

/** Pull one member out of the Action union by its `type`. */
type ActionOf<T extends Action["type"]> = Extract<Action, { type: T }>;

/** Narrowed shape of the answering phase, used by the helpers below. */
type Answering = Extract<Phase, { kind: "answering" }>;

export function reduce(state: GameState, action: Action): ReduceResult {
  switch (action.type) {
    case "JOIN":      return join(state, action);
    case "LEAVE":     return leave(state, action);
    case "START":     return start(state, action);
    case "PICK_CARD": return pickCard(state, action);
    case "ANSWER":    return answer(state, action);
    case "TIMEOUT":   return timeout(state, action);
    case "RATE":      return rate(state, action);
    default:          return assertNever(action);
  }
}

/**
 * If a new action type is added to the union and not handled above,
 * `action` is no longer `never` here and this line stops compiling.
 */
function assertNever(x: never): never {
  throw new Error(`Unhandled action: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------- lobby

function join(state: GameState, action: ActionOf<"JOIN">): ReduceResult {
  if (state.phase.kind !== "lobby") return fail("WRONG_PHASE");
  if (state.players.some((p) => p.id === action.player.id)) return fail("ALREADY_JOINED");
  if (state.players.length >= MAX_PLAYERS) return fail("ROOM_FULL");

  const name = normalizeName(action.player.name);
  if (name === null) return fail("INVALID_NAME");
  if (state.players.some((p) => sameName(p.name, name))) return fail("NAME_TAKEN");

  const player = { ...action.player, name };   // store the cleaned-up name, not the raw one
  const players = [...state.players, player];
  const scores = { ...state.scores, [player.id]: 0 };
  return done({ ...state, players, scores });
}

/**
 * Trim and collapse inner whitespace: "  Ana   María " → "Ana María".
 * Returns null if the result is empty or too long. Length counts characters
 * as people see them, so an emoji counts as 1 (plain `.length` would say 2).
 */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  const length = [...name].length;
  return length >= 1 && length <= MAX_NAME_LENGTH ? name : null;
}

/** "ana", "Ana" and "ANA" are the same name. */
function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

/**
 * Lobby only, for now. Leaving mid-game (and reconnecting after a phone
 * sleeps) gets designed together with the WebSocket layer.
 */
function leave(state: GameState, action: ActionOf<"LEAVE">): ReduceResult {
  if (state.phase.kind !== "lobby") return fail("WRONG_PHASE");
  if (!state.players.some((p) => p.id === action.playerId)) return fail("UNKNOWN_PLAYER");

  const players = state.players.filter((p) => p.id !== action.playerId);
  const { [action.playerId]: _removed, ...scores } = state.scores;
  return done({ ...state, players, scores });
}

function start(state: GameState, action: ActionOf<"START">): ReduceResult {
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

  // Keep categories that can fill a whole column (one card per player).
  // Sorted so the result doesn't depend on the order questions arrived in.
  const qualifying = [...byCategory.keys()]
    .filter((c) => byCategory.get(c)!.length >= rows)
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

  return done({
    ...state, board, questions, phase: { kind: "picking" }, turnOwner: 0, seed: action.seed,
  });
}

// ---------------------------------------------------------------- play

/** Opening a card only changes the phase. Scores, board and turn stay put. */
function pickCard(state: GameState, action: ActionOf<"PICK_CARD">): ReduceResult {
  if (state.phase.kind !== "picking") return fail("WRONG_PHASE");
  if (state.players[state.turnOwner]?.id !== action.playerId) return fail("NOT_YOUR_TURN");

  const card = state.board.find((c) => c.id === action.cardId);
  if (!card) return fail("UNKNOWN_CARD");
  if (card.played) return fail("CARD_ALREADY_PLAYED");

  const question = state.questions[card.questionId]!;

  return done({
    ...state,
    phase: {
      kind: "answering",
      cardId: card.id,
      answerer: action.playerId,
      stake: stakeOf(question),
      deadline: deadlineFrom(action.at, question),
      tried: [],
    },
  });
}

function answer(state: GameState, action: ActionOf<"ANSWER">): ReduceResult {
  const phase = state.phase;
  if (phase.kind !== "answering") return fail("WRONG_PHASE");
  if (phase.answerer !== action.playerId) return fail("NOT_YOUR_TURN");
  if (phase.deadline !== null && action.at >= phase.deadline) return fail("TOO_LATE");

  const question = questionFor(state, phase.cardId);
  if (!choiceHandler.isValidAnswer(question.response, action.choice)) return fail("INVALID_ANSWER");

  const correct = choiceHandler.isCorrect(question.response, action.choice);
  const delta = correct ? phase.stake : -phase.stake;

  const scored: GameState = {
    ...recordAttempt(state, question.id, action.playerId, correct),
    scores: { ...state.scores, [action.playerId]: (state.scores[action.playerId] ?? 0) + delta },
  };

  return correct
    ? done(closeCard(scored, phase.cardId))
    : done(missed(scored, phase, question, action.at));
}

/**
 * Time ran out: same path as a wrong answer, but no points are lost.
 * The server sends this when the deadline passes; `at` must be past it.
 */
function timeout(state: GameState, action: ActionOf<"TIMEOUT">): ReduceResult {
  const phase = state.phase;
  if (phase.kind !== "answering" || phase.deadline === null) return fail("WRONG_PHASE");
  if (action.at < phase.deadline) return fail("TOO_EARLY");

  const question = questionFor(state, phase.cardId);
  const recorded = recordAttempt(state, question.id, phase.answerer, false);
  return done(missed(recorded, phase, question, action.at));
}

/** Players rate a question's difficulty after they've tried it. Never affects this game's scoring. */
function rate(state: GameState, action: ActionOf<"RATE">): ReduceResult {
  if (state.phase.kind === "lobby") return fail("WRONG_PHASE");
  if (!state.players.some((p) => p.id === action.playerId)) return fail("UNKNOWN_PLAYER");
  if (!state.questions[action.questionId]) return fail("UNKNOWN_QUESTION");
  if (state.attempts[action.questionId]?.[action.playerId] === undefined) return fail("NOT_ANSWERED_YET");
  if (!isDifficulty(action.difficulty)) return fail("INVALID_RATING");

  const forQuestion = { ...state.ratings[action.questionId], [action.playerId]: action.difficulty };
  return done({ ...state, ratings: { ...state.ratings, [action.questionId]: forQuestion } });
}

// ---------------------------------------------------------------- helpers

/** After a miss or a timeout: hand the question to the next player, or close it. */
function missed(state: GameState, phase: Answering, question: Question, at: number): GameState {
  const tried = [...phase.tried, phase.answerer];
  const next = question.stealable ? nextUntried(state.players.map((p) => p.id), phase.answerer, tried) : null;

  if (next === null) return closeCard(state, phase.cardId);

  return {
    ...state,
    phase: {
      ...phase,
      answerer: next,
      stake: Math.floor(phase.stake / 2),
      deadline: deadlineFrom(at, question),
      tried,
    },
  };
}

/**
 * The ONLY place a card finishes: marks it played and passes the turn.
 * The turn always advances from the turn owner, never from whoever stole.
 * That single rule is what fixes the Unity turn-skip bug.
 */
function closeCard(state: GameState, cardId: string): GameState {
  const board = state.board.map((c) => (c.id === cardId ? { ...c, played: true } : c));
  const allPlayed = board.every((c) => c.played);

  return {
    ...state,
    board,
    turnOwner: (state.turnOwner + 1) % state.players.length,
    phase: allPlayed ? { kind: "gameOver" } : { kind: "picking" },
  };
}

/** Walk the circle forward from `fromId`; first player who hasn't tried yet, or null. */
function nextUntried(order: PlayerId[], fromId: PlayerId, tried: PlayerId[]): PlayerId | null {
  const start = order.indexOf(fromId);
  for (let step = 1; step < order.length; step++) {
    const candidate = order[(start + step) % order.length]!;
    if (!tried.includes(candidate)) return candidate;
  }
  return null;
}

function recordAttempt(state: GameState, questionId: string, playerId: PlayerId, correct: boolean): GameState {
  const forQuestion = { ...state.attempts[questionId], [playerId]: correct };
  return { ...state, attempts: { ...state.attempts, [questionId]: forQuestion } };
}

function questionFor(state: GameState, cardId: string): Question {
  const card = state.board.find((c) => c.id === cardId)!;
  return state.questions[card.questionId]!;
}

export function stakeOf(question: Question): number {
  return question.points ?? question.difficulty * 100;
}

function deadlineFrom(at: number, question: Question): number | null {
  return question.timeLimitMs !== null ? at + question.timeLimitMs : null;
}

function isDifficulty(x: unknown): x is Difficulty {
  return typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 5;
}
