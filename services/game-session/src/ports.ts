/**
 * The edges of the system, as interfaces. app.ts only talks to these;
 * dynamo.ts implements them with AWS, memory.ts in plain objects for tests.
 * Swapping DynamoDB for another store would mean writing one new file.
 */
import type { GameState, PlayerId } from "@family-party/game-core";
import type { Role, RoomPack, ServerMessage } from "@family-party/protocol";
import type { Selection } from "@family-party/question-bank";

export interface Room {
  code: string;
  version: number;                         // optimistic locking: bumped on every save
  state: GameState;
  selection: Selection;                    // which packs/categories this room deals from
  hostTokenHash: string;
  playerTokens: Record<string, PlayerId>;  // sha256(token) → public player id
  createdAt: number;
  /** Private packs unlocked in this room (ids). Lasts for the room and its rematches. Absent in older rooms. */
  unlocked?: string[];
  /** Name and category count of each unlocked pack, for the rules badge on every screen. Absent in older rooms. */
  unlockedInfo?: RoomPack[];
  /** Wrong unlock codes tried in this room; capped so nobody can guess forever. */
  unlockFailures?: number;
}

export interface RoomRepo {
  get(code: string): Promise<Room | null>;
  /** false if a room with that code already exists. */
  create(room: Room): Promise<boolean>;
  /** Saves `room` with version+1, only if the stored version is still `room.version`. false on conflict. */
  save(room: Room): Promise<boolean>;
}

export interface Connection {
  connectionId: string;
  roomCode?: string;       // absent for lobby connections (catalog / create)
  role: Role;
  playerId?: PlayerId;
  connectedAt: number;
}

export interface ConnectionRepo {
  put(conn: Connection): Promise<void>;
  get(connectionId: string): Promise<Connection | null>;
  delete(connectionId: string): Promise<void>;
  listByRoom(roomCode: string): Promise<Connection[]>;
}

export interface Push {
  /** "gone" = the client vanished without a clean $disconnect. */
  send(connectionId: string, message: ServerMessage): Promise<"ok" | "gone">;
}
