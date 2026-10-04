import { createRng, shuffle } from "./random";
import { choiceHandler } from "./handlers/choice";
import { DEFAULT_RULES, RULE_LIMITS, applyRules, rowsFor } from "./rules";
import type {
  Action, AnswerResult, Card, Category, Difficulty, GameError, GameState, Phase, PlayerId, Question, ReduceResult, Rules,
} from "./types";

export const MAX_PLAYERS = 10;    // same as Unity
export const BOARD_COLUMNS = DEFAULT_RULES.columns;   // categories per board, unless the host changes it
export const MAX_NAME_LENGTH = 20;

export function initialState(): GameState {
  return {
    players: [], scores: {}, board: [], questions: {}, ratings: {}, attempts: {},
    turnOwner: 0, phase: { kind: "lobby" }, reveal: null, seed: 0, encore: [], played: [], rules: DEFAULT_RULES, picks: [], left: [],
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
    case "END":       return end(state);
    case "ENCORE":    return encore(state, action);
    case "REMATCH":   return rematch(state, action);
    case "CLOSE":     return close(state);
    case "SET_RULES": return setRules(state, action);
    case "SET_PICKS": return setPicks(state, action);
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
 * Lobby: the seat is freed (name and slot). Mid-game: the player drops out of the turn order
 * but keeps their score for the podium. If it was their turn to pick, the turn moves on; if they
 * were answering, it plays out like a timeout (no points lost, the steal goes to the next player).
 */
function leave(state: GameState, action: ActionOf<"LEAVE">): ReduceResult {
  const { playerId } = action;
  if (!state.players.some((p) => p.id === playerId)) return fail("UNKNOWN_PLAYER");
  const phase = state.phase;

  switch (phase.kind) {
    case "closed":
      return fail("WRONG_PHASE");
    case "lobby": {
      const players = state.players.filter((p) => p.id !== playerId);
      const { [playerId]: _removed, ...scores } = state.scores;
      return done({ ...state, players, scores });
    }
    case "gameOver":
      if (state.left.includes(playerId)) return done(state);
      return done({ ...state, left: [...state.left, playerId], encore: state.encore.filter((id) => id !== playerId) });
    case "picking":
    case "answering": {
      if (state.left.includes(playerId)) return done(state); // leaving twice is fine
      let next: GameState = { ...state, left: [...state.left, playerId] };
      if (state.players.every((p) => next.left.includes(p.id))) {
        return done({ ...next, phase: { kind: "gameOver" }, reveal: null }); // nobody left to play
      }
      if (phase.kind === "picking" && state.players[state.turnOwner]?.id === playerId) {
        next = { ...next, turnOwner: nextActive(next, state.turnOwner) };
      }
      if (phase.kind === "answering" && phase.answerer === playerId) {
        const question = questionFor(next, phase.cardId);
        next = missed(next, phase, question, action.at, [...phase.results, { playerId, choice: null, delta: 0 }]);
      }
      return done(next);
    }
  }
}

function start(state: GameState, action: ActionOf<"START">): ReduceResult {
  if (state.phase.kind !== "lobby") return fail("WRONG_PHASE");
  if (state.players.length < 1) return fail("NOT_ENOUGH_PLAYERS");

  const { rules } = state;
  const rows = rowsFor(rules, state.players.length);
  const rng = createRng(action.seed);

  // In later rounds, questions nobody has seen yet go first; repeats only top up.
  const seen = new Set(state.played);
  const freshFirst = (list: Question[]) => [
    ...shuffle(list.filter((q) => !seen.has(q.id)), rng),
    ...shuffle(list.filter((q) => seen.has(q.id)), rng),
  ];

  const board: Card[] = [];
  const questions: Record<string, Question> = {};
  const deal = (q: Question, column: number, id: string) => {
    questions[q.id] = { ...q, response: choiceHandler.prepare(q.response, rng) };
    board.push({ id, category: q.category, questionId: q.id, value: stakeOf(q), played: false, column });
  };

  if (rules.mixed) {
    // No category columns: any questions, shuffled across a columns × rows grid.
    const cells = shuffle(freshFirst(action.questions).slice(0, rules.columns * rows), rng);
    if (cells.length === 0) return fail("NOT_ENOUGH_QUESTIONS");
    cells.forEach((q, i) => deal(q, i % rules.columns, `cell-${i}`));
  } else {
    // Group the bank by category
    const byCategory = new Map<Category, Question[]>();
    for (const q of action.questions) {
      const list = byCategory.get(q.category) ?? [];
      list.push(q);
      byCategory.set(q.category, list);
    }

    // Keep categories that can fill a whole column.
    // Sorted so the result doesn't depend on the order questions arrived in.
    const qualifying = [...byCategory.keys()]
      .filter((c) => byCategory.get(c)!.length >= rows)
      .sort();

    const columns = shuffle(qualifying, rng).slice(0, rules.columns);
    if (columns.length === 0) return fail("NOT_ENOUGH_QUESTIONS");

    columns.forEach((category, column) => {
      freshFirst(byCategory.get(category)!)
        .slice(0, rows)
        .forEach((q, row) => deal(q, column, `${category}-${row}`));
    });
  }

  // Turn order for this round. Its own random stream, so the deal above stays the same for a seed.
  const players = rules.order === "random" ? shuffle(state.players, createRng(action.seed ^ 0x5eed0f)) : state.players;

  return done({
    ...state, players, board, questions, phase: { kind: "picking" }, turnOwner: 0, seed: action.seed, left: [],
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
      deadline: deadlineFrom(action.at, timeLimitMs(state.rules, question)),
      tried: [],
      results: [],
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
  const delta = correct ? phase.stake : penalty(state.rules, phase.stake, state.scores[action.playerId] ?? 0);
  const results = [...phase.results, { playerId: action.playerId, choice: action.choice, delta }];

  const scored: GameState = {
    ...recordAttempt(state, question.id, action.playerId, correct),
    scores: { ...state.scores, [action.playerId]: (state.scores[action.playerId] ?? 0) + delta },
  };

  return correct
    ? done(closeCard(scored, phase.cardId, action.at, results))
    : done(missed(scored, phase, question, action.at, results));
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
  const results = [...phase.results, { playerId: phase.answerer, choice: null, delta: 0 }];
  return done(missed(recorded, phase, question, action.at, results));
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
function missed(state: GameState, phase: Answering, question: Question, at: number, results: AnswerResult[]): GameState {
  const { rules } = state;
  const tried = [...phase.tried, phase.answerer];
  const canSteal = rules.steals !== "off" && question.stealable;
  const next = canSteal ? nextUntried(state.players.map((p) => p.id), phase.answerer, [...tried, ...state.left]) : null;

  if (next === null) return closeCard(state, phase.cardId, at, results);

  return {
    ...state,
    phase: {
      ...phase,
      answerer: next,
      stake: rules.steals === "full" ? phase.stake : Math.floor(phase.stake / 2),
      deadline: stealDeadline(rules, phase, question, at),
      tried,
      results,
    },
  };
}

/**
 * The ONLY place a card finishes: marks it played and passes the turn.
 * The turn always advances from the turn owner, never from whoever stole.
 * That single rule is what fixes the Unity turn-skip bug.
 */
/**
 * The host calls it a night. An open card is dropped unscored (nobody gains or loses
 * for a question they didn't get to finish) and no reveal is shown: the podium is the point.
 */
function end(state: GameState): ReduceResult {
  if (state.phase.kind !== "picking" && state.phase.kind !== "answering") return fail("WRONG_PHASE");
  return done({ ...state, phase: { kind: "gameOver" }, reveal: null });
}

// ---------------------------------------------------------------- after the game

function encore(state: GameState, action: ActionOf<"ENCORE">): ReduceResult {
  if (state.phase.kind !== "gameOver") return fail("WRONG_PHASE");
  if (!state.players.some((p) => p.id === action.playerId)) return fail("UNKNOWN_PLAYER");
  if (state.encore.includes(action.playerId)) return done(state); // asking twice is fine
  return done({ ...state, encore: [...state.encore, action.playerId] });
}

/**
 * Same room, same code, same packs: back to the lobby so latecomers can join.
 * Only players in `keep` stay (the server passes whoever is still connected),
 * so someone who went home doesn't get a turn nobody will take.
 */
function rematch(state: GameState, action: ActionOf<"REMATCH">): ReduceResult {
  if (state.phase.kind !== "gameOver") return fail("WRONG_PHASE");
  const keep = new Set(action.keep);
  const players = state.players.filter((p) => keep.has(p.id) && !state.left.includes(p.id));
  const playedNow = state.board.filter((c) => c.played).map((c) => c.questionId);

  return done({
    ...state,
    players,
    scores: Object.fromEntries(players.map((p) => [p.id, 0])),
    board: [],
    questions: {},
    turnOwner: 0,
    phase: { kind: "lobby" },
    reveal: null,
    encore: [],
    left: [],
    played: [...new Set([...state.played, ...playedNow])],
  });
}

function setRules(state: GameState, action: ActionOf<"SET_RULES">): ReduceResult {
  if (state.phase.kind !== "lobby") return fail("WRONG_PHASE");
  const rules = applyRules(state.rules, action.rules);
  return rules ? done({ ...state, rules }) : fail("INVALID_RULES");
}

export const MAX_PICKS = 60;

/** At least one, at most MAX_PICKS, no duplicates. Whether they exist is the server's check. */
function setPicks(state: GameState, action: ActionOf<"SET_PICKS">): ReduceResult {
  if (state.phase.kind !== "lobby") return fail("WRONG_PHASE");
  const { picks } = action;
  const keys = new Set(picks.map((p) => `${p.pack}\u0000${p.category}`));
  if (picks.length === 0 || picks.length > MAX_PICKS || keys.size !== picks.length) return fail("INVALID_PICKS");
  return done({ ...state, picks: picks.map(({ pack, category }) => ({ pack, category })) });
}

function close(state: GameState): ReduceResult {
  if (state.phase.kind === "closed") return fail("WRONG_PHASE");
  return done({ ...state, phase: { kind: "closed" }, reveal: null });
}

function closeCard(state: GameState, cardId: string, at: number, results: AnswerResult[]): GameState {
  const board = state.board.map((c) => (c.id === cardId ? { ...c, played: true } : c));
  const allPlayed = board.every((c) => c.played);
  const questionId = state.board.find((c) => c.id === cardId)!.questionId;

  return {
    ...state,
    board,
    reveal: { cardId, questionId, results, closedAt: at },
    turnOwner: nextActive(state, state.turnOwner),
    phase: allPlayed ? { kind: "gameOver" } : { kind: "picking" },
  };
}

/** The next seat after `from` that still plays (skips players who left). */
function nextActive(state: GameState, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (!state.left.includes(state.players[i]!.id)) return i;
  }
  return from;
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

/** The answer time this room uses for a question, in ms; null = no limit. */
function timeLimitMs(rules: Rules, question: Question): number | null {
  if (rules.timer === "off") return null;
  if (rules.timer === "question") return question.timeLimitMs;
  return rules.timer * 1000;
}

function deadlineFrom(at: number, limitMs: number | null): number | null {
  return limitMs !== null ? at + limitMs : null;
}

/**
 * How long the stealer gets. "remaining" inherits what the last player had left
 * (a timeout leaves nothing, hence the floor); "half" is half a fresh timer.
 */
function stealDeadline(rules: Rules, phase: Answering, question: Question, at: number): number | null {
  const limit = timeLimitMs(rules, question);
  if (limit === null) return null;
  switch (rules.stealTime) {
    case "fresh":
      return at + limit;
    case "half":
      return at + Math.max(RULE_LIMITS.minStealMs, Math.floor(limit / 2));
    case "remaining":
      return at + Math.max(RULE_LIMITS.minStealMs, phase.deadline !== null ? phase.deadline - at : limit);
  }
}

/** Points change for a wrong answer (≤ 0). */
function penalty(rules: Rules, stake: number, score: number): number {
  switch (rules.wrongAnswer) {
    case "lose":
      return -stake;
    case "keep":
      return 0;
    case "floor":
      return 0 - Math.min(stake, Math.max(0, score)); // never below $0 (and never -0)
  }
}

function isDifficulty(x: unknown): x is Difficulty {
  return typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 5;
}
