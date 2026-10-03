// ---- IDs ----
export type PlayerId = string;
export type CardId = string;
export type QuestionId = string;

// ---- Basics ----
/**
 * Free-form so custom packs can bring their own ("La boda de Ana").
 * The built-in packs (packages/question-bank) define their own labels.
 */
export type Category = string;

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Player {
  id: PlayerId;
  name: string;
  avatar?: string;
}

// ---- Questions: prompt (what's shown) + response (how you answer) ----
export interface Prompt {
  text: string;
  media?: { kind: "image" | "audio" | "video", url: string };
}

export interface ChoiceSpec {
  kind: "choice";
  options: string[];
  correct: number[];
}

export type ResponseSpec = ChoiceSpec; // later: | NumberSpec | TextSpec | DoodleSpec etc.

export interface Question {
  id: QuestionId;
  category: Category;
  prompt: Prompt;
  response: ResponseSpec;
  mode: "turn"; // later: | "all"
  difficulty: Difficulty;
  points?: number; // default: difficulty * 100
  timeLimitMs: number | null;
  stealable: boolean;
}

// ---- Board ----
export interface Card {
  id: CardId;
  category: Category;
  questionId: QuestionId;
  value: number;       // stake when opened, shown on the board ($100–$500); steals halve it from there
  played: boolean;
  column: number;      // where it sits on the board (0-based); a mixed board has no category columns
}

/** A category the host picked for this room. game-core only stores it; the server turns picks into questions. */
export interface Pick {
  pack: string;
  category: string;
}

/** House rules, chosen by the host in the lobby. */
export interface Rules {
  /** Wrong answer: lose the stake, nothing happens, or lose it but never below $0. */
  wrongAnswer: "lose" | "keep" | "floor";
  /** Seconds per answer: each question's own limit, a fixed one for all, or none. */
  timer: "question" | 15 | 20 | 30 | "off";
  /** A missed question passes to the next player at half or full value, or not at all. */
  steals: "off" | "half" | "full";
  /** Time the stealer gets: a fresh timer, whatever the last player had left, or half a timer. */
  stealTime: "fresh" | "remaining" | "half";
  /** Category columns on the board (3–5). */
  columns: number;
  /** Cards per column: one per player (everyone gets the same turns) or a fixed count. */
  rows: "players" | number;
  /** No category columns: cards shuffled across the grid, category shown only when opened. */
  mixed: boolean;
}

// ---- Game state ----
export type Phase =
  | { kind: "lobby" }
  | { kind: "picking" }
  | {
      kind: "answering";
      cardId: CardId;
      answerer: PlayerId;
      stake: number;
      deadline: number | null;
      tried: PlayerId[];
      results: AnswerResult[]; // everyone who answered this card so far, in order
    }
  | { kind: "gameOver" }
  /** The host closed the room for good: clients go home. */
  | { kind: "closed" };

/** One attempt at a card. `choice: null` means the time ran out. */
export interface AnswerResult {
  playerId: PlayerId;
  choice: number | null;
  delta: number;
}

/** What happened on the last card that closed: shown to everyone for a few seconds. */
export interface Reveal {
  cardId: CardId;
  questionId: QuestionId;
  results: AnswerResult[];
  closedAt: number; // server time
}

export interface GameState {
  players: Player[];
  scores: Record<PlayerId, number>;
  board: Card[];
  questions: Record<QuestionId, Question>;
  ratings: Record<QuestionId, Record<PlayerId, Difficulty>>;
  attempts: Record<QuestionId, Record<PlayerId, boolean>>; // who tried each question, and whether they got it right
  turnOwner: number; // index into players
  phase: Phase;
  reveal: Reveal | null;
  seed: number;
  /** On the podium: players who asked for another round. */
  encore: PlayerId[];
  /** Questions already played this session; later rounds deal fresh ones first. */
  played: QuestionId[];
  rules: Rules;
  /** Categories the host picked. Empty only in rooms created before picks existed. */
  picks: Pick[];
}

// ---- Actions ----
export type Action =
  | { type: "JOIN"; player: Player }
  | { type: "LEAVE"; playerId: PlayerId }
  | { type: "START"; questions: Question[]; seed: number }
  | { type: "PICK_CARD"; playerId: PlayerId; cardId: CardId; at: number }
  | { type: "ANSWER"; playerId: PlayerId; choice: number; at: number }
  | { type: "TIMEOUT"; at: number }
  | { type: "RATE"; playerId: PlayerId; questionId: QuestionId; difficulty: Difficulty }
  /** Finish early: straight to the podium with the scores as they are. */
  | { type: "END" }
  /** From the podium: "I'd play another one." */
  | { type: "ENCORE"; playerId: PlayerId }
  /** From the podium: back to the lobby with whoever is still here (`keep`), scores at 0. */
  | { type: "REMATCH"; keep: PlayerId[] }
  /** Close the room for everyone. */
  | { type: "CLOSE" }
  /** Lobby only: change some house rules. Invalid values reject the whole change. */
  | { type: "SET_RULES"; rules: Partial<Record<keyof Rules, unknown>> }
  /** Lobby only: which categories this room plays (the server has checked they exist). */
  | { type: "SET_PICKS"; picks: Pick[] };

// ---- Result: invalid actions are expected, not exceptional ----
export type GameError =
  | "WRONG_PHASE" | "NOT_YOUR_TURN" | "UNKNOWN_PLAYER" | "UNKNOWN_CARD" | "UNKNOWN_QUESTION"
  | "CARD_ALREADY_PLAYED" | "INVALID_ANSWER" | "INVALID_RATING" | "TOO_EARLY" | "TOO_LATE"
  | "NOT_ENOUGH_PLAYERS" | "NOT_ENOUGH_QUESTIONS" | "ALREADY_JOINED" | "ROOM_FULL"
  | "NOT_ANSWERED_YET" | "INVALID_NAME" | "NAME_TAKEN" | "INVALID_RULES" | "INVALID_PICKS";

export type ReduceResult =
  | { ok: true; state: GameState }
  | { ok: false; error: GameError };

export type PublicChoiceSpec = Omit<ChoiceSpec, "correct">;

// ---- What clients are allowed to see ----
export type PublicQuestion = Omit<Question, "response"> & { response: PublicChoiceSpec };

/** The last closed card, WITH its answer: safe to show once nobody can answer it anymore. */
export interface PublicReveal {
  cardId: CardId;
  category: Category;
  text: string;
  options: string[];
  correct: number[];
  results: AnswerResult[];
  closedAt: number;
}

export interface PublicState {
  players: Player[];
  scores: Record<PlayerId, number>;
  board: Card[];
  turnOwner: number;
  phase: Phase;
  /** Only the question currently being answered, without its answer. */
  current: PublicQuestion | null;
  reveal: PublicReveal | null;
  /** On the podium: who asked for another round. */
  encore: PlayerId[];
  rules: Rules;
  picks: Pick[];
}

export interface Ranking {
  player: Player;
  score: number;
  rank: number; // ties share a rank: 1, 1, 3
}
