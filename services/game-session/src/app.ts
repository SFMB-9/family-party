/**
 * The game server: turns WebSocket events into game-core actions.
 *
 *   phone ──msg──► parse ──► who is this? (connection binding, never the message)
 *                      └──► load room ──► reduce() ──► save if version unchanged ──► snapshot to the room
 *
 * Pure game rules live in game-core; this file owns identity, time, persistence and fan-out.
 */
import {
  initialState,
  publicView,
  reduce,
  type Action,
  type GameError,
  type Question,
} from "@family-party/game-core";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isRoomCode,
  parseClientMessage,
  type ClientMessage,
  type PackInfo,
  type ProtocolError,
} from "@family-party/protocol";
import type { Pack, Selection } from "@family-party/question-bank";
import type { Access, PackSource, PrivatePack } from "./packs";
import type { Pick } from "@family-party/game-core";
import type { Connection, ConnectionRepo, Push, Room, RoomRepo } from "./ports";

export interface Deps {
  rooms: RoomRepo;
  connections: ConnectionRepo;
  push: Push;
  now: () => number;
  /** Secure randomness: room codes, ids, tokens, deal seeds. */
  randomInt: (maxExclusive: number) => number;
  randomToken: () => string;
  hash: (token: string) => string;
  /** Questions for a selection, from the public packs plus `extra` (private packs unlocked in the room). */
  questions: (selection: Selection, extra: Pack[]) => Question[];
  /** Public packs, then `extra` marked private. */
  catalog: (extra: Pack[]) => PackInfo[];
  /** What a new room starts with: every public category. */
  defaultPicks: () => Pick[];
  /** Do these picks name categories that exist (in the public packs or `extra`)? */
  picksExist: (picks: Pick[], extra: Pack[]) => boolean;
  /** Private packs (S3 in the Lambda). */
  privatePacks: PackSource;
  verifyCode: (code: string, access: Access) => Promise<boolean>;
}

type AppError = GameError | ProtocolError;
type Mutation = { ok: true; room: Room } | { ok: false; error: AppError };

const MAX_SAVE_ATTEMPTS = 5;
/** Wrong codes a room may try. With long passphrases and API Gateway throttling, guessing is hopeless. */
export const MAX_UNLOCK_FAILURES = 10;

export function createApp(deps: Deps) {
  const { rooms, connections, push } = deps;

  // ------------------------------------------------------------ helpers

  const sendError = (connectionId: string, error: AppError) => push.send(connectionId, { t: "error", error });

  /**
   * Optimistic locking. Two phones answering at the same instant both load version N;
   * the first save wins (N → N+1), the second fails its condition, reloads and re-runs.
   * Re-running is safe because reduce() is pure: same input, same output, no side effects.
   */
  async function mutate(code: string, change: (room: Room) => Mutation): Promise<Mutation> {
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
      const room = await rooms.get(code);
      if (!room) return { ok: false, error: "ROOM_NOT_FOUND" };
      const result = change(room);
      if (!result.ok) return result;
      if (await rooms.save(result.room)) return { ok: true, room: { ...result.room, version: room.version + 1 } };
    }
    return { ok: false, error: "BUSY" };
  }

  /** Apply one game-core action to the room. */
  const applyAction = (room: Room, action: Action): Mutation => {
    const result = reduce(room.state, action);
    return result.ok ? { ok: true, room: { ...room, state: result.state } } : { ok: false, error: result.error };
  };

  /**
   * Send every connection in the room its own snapshot (same view, different `you`).
   * `include` covers a fresh connection the index may not show yet: the byRoom
   * index is eventually consistent, so a just-written connection can be missing for a moment.
   */
  async function broadcast(room: Room, include?: Connection): Promise<void> {
    const listed = await connections.listByRoom(room.code);
    const all = include && !listed.some((c) => c.connectionId === include.connectionId) ? [...listed, include] : listed;

    const connected = [...new Set(all.filter((c) => c.role === "player" && c.playerId).map((c) => c.playerId!))];
    const view = publicView(room.state);
    const serverTime = deps.now();

    await Promise.all(
      all.map(async (c) => {
        const you = c.playerId ? { role: c.role, playerId: c.playerId } : { role: c.role };
        const result = await push.send(c.connectionId, { t: "state", room: room.code, view, connected, you, serverTime });
        if (result === "gone") await connections.delete(c.connectionId);
      }),
    );
  }

  /**
   * A new room's state: categories are picked in the lobby now, so it starts with every public
   * category, or with what an older web client still sends on create (the deploy window).
   */
  const startingState = (selection: Selection) => {
    const packs = selection.packs?.length ? new Set(selection.packs) : null;
    const categories = selection.categories?.length ? new Set(selection.categories) : null;
    const picks = deps.defaultPicks().filter((p) => (!packs || packs.has(p.pack)) && (!categories || categories.has(p.category)));
    const result = reduce(initialState(), { type: "SET_PICKS", picks });
    return result.ok ? result.state : initialState();
  };

  /** The private packs this room unlocked, out of all of them. */
  const unlockedIn = (room: Room, all: PrivatePack[]) => all.filter((p) => room.unlocked?.includes(p.pack.id)).map((p) => p.pack);
  /** Most rooms never unlock anything: only touch S3 when this one did. */
  const extraFor = async (room: Room | null) => (room?.unlocked?.length ? unlockedIn(room, await deps.privatePacks.list()) : []);

  const newRoomCode = () =>
    Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[deps.randomInt(ROOM_CODE_ALPHABET.length)]).join("");

  // ------------------------------------------------------------ routes

  /** $connect. Returning false makes API Gateway refuse the connection (HTTP 403). */
  async function connect(connectionId: string, roomParam: string | undefined): Promise<boolean> {
    let roomCode: string | undefined;
    if (roomParam !== undefined) {
      const code = roomParam.toUpperCase();
      if (!isRoomCode(code) || !(await rooms.get(code))) return false; // closes the "anyone can join anything" gap
      roomCode = code;
    }
    await connections.put({ connectionId, role: "viewer", connectedAt: deps.now(), ...(roomCode && { roomCode }) });
    return true;
  }

  /** $disconnect. Players stay in the game (they can reconnect with their token); others see them go grey. */
  async function disconnect(connectionId: string): Promise<void> {
    const conn = await connections.get(connectionId);
    await connections.delete(connectionId);
    if (conn?.roomCode) {
      const room = await rooms.get(conn.roomCode);
      if (room) await broadcast(room);
    }
  }

  /** $default: every message after the socket is open. */
  async function message(connectionId: string, raw: string | undefined): Promise<void> {
    const msg = parseClientMessage(raw);
    if (!msg) return void (await sendError(connectionId, "BAD_MESSAGE"));

    // Heartbeats are answered before any database read: they cost one Lambda call and two messages, nothing more.
    if (msg.t === "ping") return void (await push.send(connectionId, { t: "pong", serverTime: deps.now() }));

    const conn = await connections.get(connectionId);
    if (!conn) return void (await sendError(connectionId, "NO_ROOM"));

    await handle(conn, msg);
  }

  /** Everything except heartbeats, which `message` answers before loading the connection. */
  async function handle(conn: Connection, msg: Exclude<ClientMessage, { t: "ping" }>): Promise<void> {
    const { connectionId } = conn;

    // ---- lobby messages: no room needed
    if (msg.t === "catalog") {
      // Only the host of a room sees its unlocked private packs; everyone else gets the public list.
      const room = conn.role === "host" && conn.roomCode ? await rooms.get(conn.roomCode) : null;
      await push.send(connectionId, { t: "catalog", packs: deps.catalog(await extraFor(room)) });
      return;
    }
    if (msg.t === "create") {
      const selection: Selection = {
        ...(msg.packs && { packs: msg.packs }),
        ...(msg.categories && { categories: msg.categories }),
      };
      if (deps.questions(selection, []).length === 0) return void (await sendError(connectionId, "NOT_ENOUGH_QUESTIONS_FOR_SELECTION"));

      const hostToken = deps.randomToken();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newRoomCode();
        const created = await rooms.create({
          code,
          version: 0,
          state: startingState(selection),
          selection,
          hostTokenHash: deps.hash(hostToken),
          playerTokens: {},
          createdAt: deps.now(),
        });
        if (created) {
          await push.send(connectionId, { t: "created", room: code, hostToken });
          return;
        }
      }
      return void (await sendError(connectionId, "BUSY"));
    }

    // ---- everything else happens inside a room
    if (!conn.roomCode) return void (await sendError(connectionId, "NO_ROOM"));
    const code = conn.roomCode;

    if (msg.t === "hello") {
      const room = await rooms.get(code);
      if (!room) return void (await sendError(connectionId, "ROOM_NOT_FOUND"));

      let bound: Connection = { ...conn, role: "viewer" };
      delete bound.playerId;
      if (msg.token) {
        const h = deps.hash(msg.token);
        if (h === room.hostTokenHash) bound = { ...bound, role: "host" };
        else if (room.playerTokens[h]) bound = { ...bound, role: "player", playerId: room.playerTokens[h] };
        else await sendError(connectionId, "BAD_TOKEN"); // stays a viewer; the client can join fresh
      }
      await connections.put(bound);
      await broadcast(room, bound);
      return;
    }

    if (msg.t === "join") {
      if (conn.role === "player") return void (await sendError(connectionId, "ALREADY_JOINED"));
      const token = deps.randomToken();
      const playerId = `p_${deps.randomToken().slice(0, 10)}`;

      const result = await mutate(code, (room) => {
        const joined = applyAction(room, { type: "JOIN", player: { id: playerId, name: msg.name } });
        if (!joined.ok) return joined;
        return { ok: true, room: { ...joined.room, playerTokens: { ...room.playerTokens, [deps.hash(token)]: playerId } } };
      });
      if (!result.ok) return void (await sendError(connectionId, result.error));

      const bound: Connection = { ...conn, role: "player", playerId };
      await connections.put(bound);
      await push.send(connectionId, { t: "joined", playerId, token });
      await broadcast(result.room, bound);
      return;
    }

    if (msg.t === "unlock") return void (await unlock(conn, code, msg.code));

    if (msg.t === "leave") {
      if (conn.role !== "player" || !conn.playerId) return void (await sendError(connectionId, "NOT_A_PLAYER"));
      const playerId = conn.playerId;
      const result = await mutate(code, (room) => {
        const next = applyAction(room, { type: "LEAVE", playerId, at: deps.now() });
        if (!next.ok) return next;
        // The seat's token goes too: coming back means joining fresh (or watching, mid-game).
        const playerTokens = Object.fromEntries(Object.entries(room.playerTokens).filter(([, id]) => id !== playerId));
        return { ok: true, room: { ...next.room, playerTokens } };
      });
      if (!result.ok) return void (await sendError(connectionId, result.error));
      const viewer: Connection = { ...conn, role: "viewer" };
      delete viewer.playerId;
      await connections.put(viewer);
      await broadcast(result.room, viewer);
      return;
    }

    // ---- game actions: identity from the connection, time from the server
    const at = deps.now();
    let change: (room: Room) => Mutation;

    switch (msg.t) {
      case "start": {
        if (conn.role !== "host") return void (await sendError(connectionId, "NOT_HOST"));
        const loaded = await rooms.get(code);
        const privates = loaded?.unlocked?.length ? await deps.privatePacks.list() : [];
        change = (room) =>
          applyAction(room, {
            type: "START",
            // Rooms from before lobby picks have none: they keep dealing from their home-page selection.
            questions: deps.questions(room.state.picks.length ? { picks: room.state.picks } : room.selection, unlockedIn(room, privates)),
            seed: deps.randomInt(2 ** 31),
          });
        break;
      }
      case "end":
      case "close":
        if (conn.role !== "host") return void (await sendError(connectionId, "NOT_HOST"));
        change = (room) => applyAction(room, { type: msg.t === "end" ? "END" : "CLOSE" });
        break;
      case "picks": {
        if (conn.role !== "host") return void (await sendError(connectionId, "NOT_HOST"));
        if (!deps.picksExist(msg.picks, await extraFor(await rooms.get(code)))) return void (await sendError(connectionId, "UNKNOWN_CATEGORY"));
        const picks = msg.picks;
        change = (room) => applyAction(room, { type: "SET_PICKS", picks });
        break;
      }
      case "rules": {
        if (conn.role !== "host") return void (await sendError(connectionId, "NOT_HOST"));
        const rules = msg.rules;
        change = (room) => applyAction(room, { type: "SET_RULES", rules });
        break;
      }
      case "rematch": {
        if (conn.role !== "host") return void (await sendError(connectionId, "NOT_HOST"));
        // Whoever still has the room open plays again; phones that went home are dropped,
        // and so are their reconnect tokens (coming back means joining fresh).
        const here = new Set(
          (await connections.listByRoom(code)).flatMap((c) => (c.role === "player" && c.playerId ? [c.playerId] : [])),
        );
        change = (room) => {
          const next = applyAction(room, { type: "REMATCH", keep: [...here] });
          if (!next.ok) return next;
          const playerTokens = Object.fromEntries(Object.entries(room.playerTokens).filter(([, id]) => here.has(id)));
          return { ok: true, room: { ...next.room, playerTokens } };
        };
        break;
      }
      case "timeout":
        // Anyone in the room may poke; game-core rejects it unless the deadline really passed.
        change = (room) => applyAction(room, { type: "TIMEOUT", at });
        break;
      case "pick":
      case "answer":
      case "rate":
      case "encore": {
        if (conn.role !== "player" || !conn.playerId) return void (await sendError(connectionId, "NOT_A_PLAYER"));
        const playerId = conn.playerId;
        const action: Action =
          msg.t === "pick" ? { type: "PICK_CARD", playerId, cardId: msg.cardId, at }
          : msg.t === "answer" ? { type: "ANSWER", playerId, choice: msg.choice, at }
          : msg.t === "encore" ? { type: "ENCORE", playerId }
          : { type: "RATE", playerId, questionId: msg.questionId, difficulty: msg.difficulty };
        change = (room) => applyAction(room, action);
        break;
      }
    }

    const result = await mutate(code, change);
    if (!result.ok) {
      // Early/duplicate timeout pokes are normal traffic (every client pokes); don't spam errors back.
      if (msg.t !== "timeout") await sendError(connectionId, result.error);
      return;
    }
    await broadcast(result.room);
  }

  /**
   * The host typed a code. Check it against every private pack this room hasn't unlocked yet
   * (only hashes are compared). A match unlocks that pack for this room, picks all its
   * categories, and sends the host the updated catalog. A miss counts toward the room's cap.
   */
  async function unlock(conn: Connection, code: string, attempt: string): Promise<void> {
    const { connectionId } = conn;
    if (conn.role !== "host") return void (await sendError(connectionId, "NOT_HOST"));
    const room = await rooms.get(code);
    if (!room) return void (await sendError(connectionId, "ROOM_NOT_FOUND"));
    if (room.state.phase.kind !== "lobby") return void (await sendError(connectionId, "WRONG_PHASE"));
    if ((room.unlockFailures ?? 0) >= MAX_UNLOCK_FAILURES) return void (await sendError(connectionId, "TOO_MANY_ATTEMPTS"));

    const all = await deps.privatePacks.list();
    let match: PrivatePack | undefined;
    for (const candidate of all.filter((p) => !room.unlocked?.includes(p.pack.id))) {
      if (await deps.verifyCode(attempt, candidate.access)) {
        match = candidate;
        break;
      }
    }

    if (!match) {
      await mutate(code, (r) => ({ ok: true, room: { ...r, unlockFailures: (r.unlockFailures ?? 0) + 1 } }));
      return void (await sendError(connectionId, "BAD_CODE"));
    }

    const pack = match.pack;
    const categories = [...new Set(pack.questions.filter((q) => !q.hidden).map((q) => q.category))];
    const result = await mutate(code, (r) => {
      if (r.state.phase.kind !== "lobby") return { ok: false, error: "WRONG_PHASE" };
      const unlocked = [...new Set([...(r.unlocked ?? []), pack.id])];
      const fresh = categories.filter((c) => !r.state.picks.some((p) => p.pack === pack.id && p.category === c));
      return applyAction({ ...r, unlocked }, { type: "SET_PICKS", picks: [...r.state.picks, ...fresh.map((category) => ({ pack: pack.id, category }))] });
    });
    if (!result.ok) return void (await sendError(connectionId, result.error));

    await push.send(connectionId, { t: "unlocked", pack: { id: pack.id, name: pack.name } });
    await push.send(connectionId, { t: "catalog", packs: deps.catalog(unlockedIn(result.room, all)) });
    await broadcast(result.room);
  }

  return { connect, disconnect, message };
}
