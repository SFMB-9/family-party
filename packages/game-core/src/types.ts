// ---- IDs ----
export type PlayerId = string;
export type CardId = string;
export type QuestionId = string;

// ---- Basics ----
export type Category =
  | "general" | "family" | "geography" | "history"
  | "music" | "cinema" | "sports" | "science"

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
  played: boolean;
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
    }
  | { kind: "gameOver" };

export interface GameState {
  players: Player[];
  scores: Record<PlayerId, number>;
  board: Card[];
  questions: Record<QuestionId, Question>;
  ratings: Record<QuestionId, Record<PlayerId, Difficulty>>;
  turnOwner: number; // index into players
  phase: Phase;
  seed: number;
}

// ---- Actions ----
export type Action =
  | { type: "JOIN"; player: Player }
  | { type: "LEAVE"; playerId: PlayerId }
  | { type: "START"; questions: Question[]; seed: number }
  | { type: "PICK_CARD"; playerId: PlayerId; cardId: CardId; at: number }
  | { type: "ANSWER"; playerId: PlayerId; choice: number; at: number }
  | { type: "TIMEOUT"; at: number }
  | { type: "RATE"; playerId: PlayerId; questionId: QuestionId; difficulty: Difficulty };

// ---- Result: invalid actions are expected, not exceptional ----
export type GameError =
  | "NOT_YOUR_TURN" | "WRONG_PHASE" | "UNKNOWN_CARD" | "CARD_ALREADY_PLAYED" 
  | "INVALID_ANSWER" | "ALREADY_TRIED" | "TOO_EARLY" | "NOT_ENOUGH_QUESTIONS"
  | "ALREADY_JOINED" | "NOT_ANSWERED_YET" | "ROOM_FULL" | "NOT_ENOUGH_PLAYERS";

export type ReduceResult =
  | { ok: true; state: GameState }
  | { ok: false; error: GameError };

export type PublicChoiceSpec = Omit<ChoiceSpec, "correct">;