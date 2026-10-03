/** In-memory adapters: the whole server runs in a unit test, no AWS. */
import type { ServerMessage } from "@family-party/protocol";
import type { Connection, ConnectionRepo, Push, Room, RoomRepo } from "./ports";

const clone = <T>(x: T): T => structuredClone(x);

export class MemoryRooms implements RoomRepo {
  readonly items = new Map<string, Room>();
  /** Test hook: make the next N saves fail as if another Lambda saved first. */
  conflictsToSimulate = 0;

  async get(code: string) {
    const r = this.items.get(code);
    return r ? clone(r) : null;
  }
  async create(room: Room) {
    if (this.items.has(room.code)) return false;
    this.items.set(room.code, clone(room));
    return true;
  }
  async save(room: Room) {
    const stored = this.items.get(room.code);
    if (!stored || stored.version !== room.version) return false;
    if (this.conflictsToSimulate > 0) {
      this.conflictsToSimulate--;
      stored.version++; // someone else "won" the race
      return false;
    }
    this.items.set(room.code, clone({ ...room, version: room.version + 1 }));
    return true;
  }
}

export class MemoryConnections implements ConnectionRepo {
  readonly items = new Map<string, Connection>();
  async put(conn: Connection) {
    this.items.set(conn.connectionId, clone(conn));
  }
  async get(id: string) {
    const c = this.items.get(id);
    return c ? clone(c) : null;
  }
  async delete(id: string) {
    this.items.delete(id);
  }
  async listByRoom(code: string) {
    return [...this.items.values()].filter((c) => c.roomCode === code).map(clone);
  }
}

export class MemoryPush implements Push {
  readonly sent: { to: string; message: ServerMessage }[] = [];
  readonly gone = new Set<string>();
  async send(to: string, message: ServerMessage) {
    if (this.gone.has(to)) return "gone" as const;
    this.sent.push({ to, message });
    return "ok" as const;
  }
  /** Last message of a given type sent to a connection. */
  last<T extends ServerMessage["t"]>(to: string, t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const s = this.sent[i]!;
      if (s.to === to && s.message.t === t) return s.message as Extract<ServerMessage, { t: T }>;
    }
    return undefined;
  }
}
