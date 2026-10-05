/**
 * The WebSocket contract between browsers and the game-session Lambda.
 * Imported by both sides, so a renamed field breaks the build instead of production.
 *
 * Rule: the client never says WHO it is or WHEN something happened.
 * Identity comes from the connection (bound via a secret token), time from the server clock.
 */
import type { CardId, Difficulty, GameError, Pick, PlayerId, PublicState, QuestionId, Rules } from "@family-party/game-core";

// ---------------------------------------------------------------- client → server

export type ClientMessage =
  /** First message after opening a socket. Binds the connection to a role in the room. */
  | { t: "hello"; token?: string }
  /** Lobby only: list the available question packs (no answers included). */
  | { t: "catalog" }
  /** Lobby only: create a room; the sender becomes its host. */
  | { t: "create"; packs?: string[]; categories?: string[] }
  /** Become a player in the room. */
  | { t: "join"; name: string }
  /** Host only. */
  | { t: "start" }
  /** Host only: finish now and show the podium. */
  | { t: "end" }
  /** Host only, from the podium: same room, back to the lobby. */
  | { t: "rematch" }
  /** Host only: close the room; everyone goes home. */
  | { t: "close" }
  /** Player, from the podium: "I'd play another one." */
  | { t: "encore" }
  /** Player: give up the seat. Lobby: removed. Mid-game: out of the turn order, score kept. */
  | { t: "leave" }
  /** Host only, in the lobby: change some house rules (game-core validates the values). */
  | { t: "rules"; rules: Partial<Record<keyof Rules, unknown>> }
  /** Host only, in the lobby: try a private pack's code. A match unlocks it for this room. */
  | { t: "unlock"; code: string }
  /** Host only, in the lobby: which categories to play (each must exist in the catalog). */
  | { t: "picks"; picks: Pick[] }
  /** Heartbeat: measures latency and keeps API Gateway from closing an idle socket (10 min). */
  | { t: "ping" }
  | { t: "pick"; cardId: CardId }
  | { t: "answer"; choice: number }
  /** "My countdown hit zero." The server checks against its own clock. */
  | { t: "timeout" }
  | { t: "rate"; questionId: QuestionId; difficulty: Difficulty };

// ---------------------------------------------------------------- server → client

export type Role = "host" | "player" | "viewer";

export interface PackInfo {
  id: string;
  name: string;
  description: string;
  categories: { name: string; count: number }[];
  /** A private pack unlocked in this room (never listed anywhere else). */
  private?: boolean;
}

/** A private pack unlocked in a room, as every connection in it sees it: a name and a size, never questions or codes. */
export interface RoomPack {
  id: string;
  name: string;
  categories: number;
}

export type ServerMessage =
  | {
      t: "state";
      room: string;
      view: PublicState;
      connected: PlayerId[];        // players with at least one open connection
      you: { role: Role; playerId?: PlayerId };
      serverTime: number;           // lets clients convert server deadlines to their own clock
      /** Private packs unlocked in this room, so every rules badge can name the pack. Absent when none. */
      packs?: RoomPack[];
    }
  | { t: "catalog"; packs: PackInfo[] }
  /** The code matched: this pack is now part of the room. */
  | { t: "unlocked"; pack: { id: string; name: string } }
  | { t: "created"; room: string; hostToken: string }
  | { t: "joined"; playerId: PlayerId; token: string }
  | { t: "error"; error: GameError | ProtocolError }
  /** Answer to a ping. serverTime lets clients refine their clock offset between snapshots. */
  | { t: "pong"; serverTime: number };

export type ProtocolError =
  | "BAD_MESSAGE"       // not valid JSON / unknown type / wrong field types
  | "NO_ROOM"           // message needs a room but the connection has none
  | "ROOM_NOT_FOUND"
  | "NOT_HOST"
  | "NOT_A_PLAYER"      // connection isn't bound to a player
  | "BAD_TOKEN"
  | "NOT_ENOUGH_QUESTIONS_FOR_SELECTION"
  | "UNKNOWN_CATEGORY"  // a pick names a category no pack has
  | "BAD_CODE"          // no private pack opens with that code
  | "TOO_MANY_ATTEMPTS" // this room tried too many wrong codes
  | "BUSY";             // too much contention on the room, try again

// ---------------------------------------------------------------- validation

const MAX_ID_LENGTH = 100;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isShortString = (x: unknown, max = MAX_ID_LENGTH): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
/** Flat object of a few primitive values: the shape of a rules change. Values are checked by game-core. */
const isRulesPatch = (x: unknown): x is Record<string, string | number | boolean> =>
  isObject(x) &&
  Object.keys(x).length <= 10 &&
  Object.entries(x).every(([k, v]) => isShortString(k, 20) && ["string", "number", "boolean"].includes(typeof v));
const isStringList = (x: unknown): x is string[] =>
  Array.isArray(x) && x.length <= 50 && x.every((s) => isShortString(s));

/**
 * Turn a raw WebSocket frame into a typed message, or null if it's malformed.
 * Shape-checks only; game rules (whose turn, valid choice range…) stay in game-core.
 */
export function parseClientMessage(raw: string | undefined): ClientMessage | null {
  if (!raw || raw.length > 4_000) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || typeof data.t !== "string") return null;

  switch (data.t) {
    case "hello":
      if (data.token !== undefined && !isShortString(data.token, 200)) return null;
      return data.token === undefined ? { t: "hello" } : { t: "hello", token: data.token };
    case "catalog":
    case "ping":
    case "start":
    case "end":
    case "rematch":
    case "close":
    case "encore":
    case "leave":
    case "timeout":
      return { t: data.t };
    case "create": {
      if (data.packs !== undefined && !isStringList(data.packs)) return null;
      if (data.categories !== undefined && !isStringList(data.categories)) return null;
      const msg: ClientMessage = { t: "create" };
      if (data.packs) msg.packs = data.packs;
      if (data.categories) msg.categories = data.categories;
      return msg;
    }
    case "unlock":
      return typeof data.code === "string" && data.code.trim().length > 0 && data.code.length <= 100
        ? { t: "unlock", code: data.code }
        : null;
    case "picks":
      return Array.isArray(data.picks) &&
        data.picks.length <= 60 &&
        data.picks.every((p) => isObject(p) && isShortString(p.pack) && isShortString(p.category, 80))
        ? { t: "picks", picks: (data.picks as { pack: string; category: string }[]).map(({ pack, category }) => ({ pack, category })) }
        : null;
    case "rules":
      return isRulesPatch(data.rules) ? { t: "rules", rules: data.rules } : null;
    case "join":
      // Length and spacing are game rules (normalizeName in game-core); here we only check it's text.
      return typeof data.name === "string" && data.name.length <= 200 ? { t: "join", name: data.name } : null;
    case "pick":
      return isShortString(data.cardId) ? { t: "pick", cardId: data.cardId } : null;
    case "answer":
      return typeof data.choice === "number" ? { t: "answer", choice: data.choice } : null;
    case "rate":
      return isShortString(data.questionId) && typeof data.difficulty === "number"
        ? { t: "rate", questionId: data.questionId, difficulty: data.difficulty as Difficulty }
        : null;
    default:
      return null;
  }
}

/** 4 letters from an alphabet without look-alikes (no I/L/O/0/1), easy to read out loud on a call. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

export function isRoomCode(x: unknown): x is string {
  return (
    typeof x === "string" &&
    x.length === ROOM_CODE_LENGTH &&
    [...x].every((ch) => ROOM_CODE_ALPHABET.includes(ch))
  );
}
