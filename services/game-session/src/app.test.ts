import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Question } from "@family-party/game-core";
import { catalog as catalogOf, toGameQuestion, type Pack } from "@family-party/question-bank";
import { MAX_UNLOCK_FAILURES, createApp } from "./app";
import { MemoryConnections, MemoryPacks, MemoryPush, MemoryRooms } from "./memory";
import { hashCode, verifyCode, type PrivatePack } from "./packs";

// ---------------------------------------------------------------- test harness

/** 3 categories × 4 questions, 10s timer, answer "A" is always right. */
const CATEGORIES = ["Uno", "Dos", "Tres"];
const BANK: Question[] = CATEGORIES.flatMap((category) =>
  [0, 1, 2, 3].map((i) => ({
    id: `${category}-${i}`,
    category,
    prompt: { text: `${category} ${i}` },
    response: { kind: "choice" as const, options: ["A", "B", "C"], correct: [0] },
    mode: "turn" as const,
    difficulty: 1 as const,
    timeLimitMs: 10_000,
    stealable: true,
  })),
);

/** A private pack for the unlock tests: one category, 4 questions. Locked with a fast hash. */
const FAMILIA: Pack = {
  id: "familia",
  name: "Familia",
  description: "",
  questions: [0, 1, 2, 3].map((i) => ({
    id: `f${i}`, category: "Viajes", text: `Viaje ${i}`, options: ["A", "B"], correct: [0], difficulty: 1 as const, timeLimitSec: 10, stealable: true,
  })),
};
const CODE = "TAMALESABUELA26";
let familia: PrivatePack;
let privatePacks: MemoryPacks;

let rooms: MemoryRooms;
let connections: MemoryConnections;
let push: MemoryPush;
let clock: number;
let counter: number;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  familia ??= { pack: FAMILIA, access: await hashCode(CODE, { N: 2 ** 10, r: 8, p: 1 }) };
  privatePacks = new MemoryPacks([familia]);
  rooms = new MemoryRooms();
  connections = new MemoryConnections();
  push = new MemoryPush();
  clock = 1_000_000;
  counter = 0;
  app = createApp({
    rooms,
    connections,
    push,
    now: () => clock,
    randomInt: (max) => counter++ % max,
    randomToken: () => `token-${counter++}-xxxxxxxxxxxxxxxxxxxx`,
    hash: (t) => createHash("sha256").update(t).digest("hex"),
    questions: (selection, extra) => {
      const all = [...BANK, ...extra.flatMap((p) => p.questions.map(toGameQuestion))];
      return selection.picks ? all.filter((q) => selection.picks!.some((p) => p.category === q.category)) : all;
    },
    catalog: (extra) => [
      { id: "test", name: "Test", description: "", categories: CATEGORIES.map((name) => ({ name, count: 4 })) },
      ...catalogOf(extra).map((p) => ({ ...p, private: true })),
    ],
    defaultPicks: () => CATEGORIES.map((category) => ({ pack: "test", category })),
    picksExist: (picks, extra) =>
      picks.every((p) => (p.pack === "test" && CATEGORIES.includes(p.category)) || extra.some((e) => e.id === p.pack)),
    privatePacks,
    verifyCode,
  });
});

const send = (conn: string, msg: object) => app.message(conn, JSON.stringify(msg));

/** Host creates a room from a lobby connection, then reconnects into it like the web app does. */
async function createRoom(): Promise<{ code: string; hostToken: string }> {
  await app.connect("lobby", undefined);
  await send("lobby", { t: "create" });
  const created = push.last("lobby", "created")!;
  await app.connect("host", created.room);
  await send("host", { t: "hello", token: created.hostToken });
  return { code: created.room, hostToken: created.hostToken };
}

async function joinAs(conn: string, code: string, name: string) {
  await app.connect(conn, code);
  await send(conn, { t: "hello" });
  await send(conn, { t: "join", name });
  return push.last(conn, "joined")!;
}

const stateOf = (conn: string) => push.last(conn, "state")!;
const errorOf = (conn: string) => push.last(conn, "error")?.error;

// ---------------------------------------------------------------- tests

describe("heartbeat", () => {
  it("answers a ping with the server time, without touching the database", async () => {
    let reads = 0;
    const get = connections.get.bind(connections);
    connections.get = async (id) => { reads++; return get(id); };

    await app.message("never-connected", JSON.stringify({ t: "ping" }));   // works even with no connection record
    expect(push.last("never-connected", "pong")).toEqual({ t: "pong", serverTime: clock });
    expect(reads).toBe(0);
  });
});

describe("rooms and connections", () => {
  it("refuses $connect to a room that doesn't exist", async () => {
    expect(await app.connect("x", "ZZZZ")).toBe(false);
    expect(await app.connect("y", "nope!")).toBe(false);
  });

  it("creates a room, binds the creator's token as host", async () => {
    const { code } = await createRoom();
    expect(stateOf("host").room).toBe(code);
    expect(stateOf("host").you).toEqual({ role: "host" });
  });

  it("sends the catalog without answers", async () => {
    await app.connect("lobby", undefined);
    await send("lobby", { t: "catalog" });
    expect(push.last("lobby", "catalog")!.packs[0]!.id).toBe("test");
  });

  it("joining gives the phone a token and tells the whole room", async () => {
    const { code } = await createRoom();
    const ana = await joinAs("ana", code, "Ana");

    expect(ana.token).toBeTruthy();
    expect(stateOf("ana").you).toEqual({ role: "player", playerId: ana.playerId });
    expect(stateOf("host").view.players.map((p) => p.name)).toEqual(["Ana"]);
    expect(stateOf("host").connected).toEqual([ana.playerId]);
  });

  it("never stores plain tokens", async () => {
    const { code, hostToken } = await createRoom();
    const ana = await joinAs("ana", code, "Ana");
    const stored = JSON.stringify([...rooms.items.values()]);
    expect(stored).not.toContain(hostToken);
    expect(stored).not.toContain(ana.token);
  });
});

describe("reconnecting", () => {
  it("restores the same seat with the token after a phone drops", async () => {
    const { code } = await createRoom();
    const ana = await joinAs("ana", code, "Ana");

    await app.disconnect("ana");
    expect(stateOf("host").connected).toEqual([]);         // Ana goes grey on the TV

    await app.connect("ana-again", code);
    await send("ana-again", { t: "hello", token: ana.token });
    expect(stateOf("ana-again").you).toEqual({ role: "player", playerId: ana.playerId });
    expect(stateOf("host").connected).toEqual([ana.playerId]);
    expect(stateOf("host").view.players).toHaveLength(1);   // same player, not a duplicate
  });

  it("an unknown token just makes you a viewer", async () => {
    const { code } = await createRoom();
    await app.connect("x", code);
    await send("x", { t: "hello", token: "made-up" });
    expect(errorOf("x")).toBe("BAD_TOKEN");
    expect(stateOf("x").you).toEqual({ role: "viewer" });
  });
});

describe("playing", () => {
  async function startedGame() {
    const { code } = await createRoom();
    const ana = await joinAs("ana", code, "Ana");
    const beto = await joinAs("beto", code, "Beto");
    await send("host", { t: "start" });
    return { code, ana, beto };
  }

  it("only the host can start", async () => {
    const { code } = await createRoom();
    await joinAs("ana", code, "Ana");
    await send("ana", { t: "start" });
    expect(errorOf("ana")).toBe("NOT_HOST");
  });

  it("only the host can end the game early", async () => {
    await startedGame();
    await send("ana", { t: "end" });
    expect(errorOf("ana")).toBe("NOT_HOST");
    await send("host", { t: "end" });
    expect(stateOf("ana").view.phase).toEqual({ kind: "gameOver" });
  });

  it("plays a turn end to end, with identity taken from the connection", async () => {
    const { ana } = await startedGame();
    const board = stateOf("host").view.board;
    expect(board.length).toBeGreaterThan(0);

    await send("ana", { t: "pick", cardId: board[0]!.id });
    const view = stateOf("beto").view;
    expect(view.phase).toMatchObject({ kind: "answering", answerer: ana.playerId });
    expect(view.current?.response.options).toHaveLength(3);
    expect(JSON.stringify(view)).not.toContain("correct");    // phones never see the answer

    const right = view.current!.response.options.indexOf("A");
    await send("ana", { t: "answer", choice: right });
    expect(stateOf("host").view.scores[ana.playerId]).toBe(100);
  });

  it("a phone can't act for someone else: there's no field to lie with", async () => {
    const { beto } = await startedGame();
    const board = stateOf("host").view.board;
    // Beto tries to pick on Ana's turn, even claiming to be her.
    await app.message("beto", JSON.stringify({ t: "pick", cardId: board[0]!.id, playerId: "whoever" }));
    expect(errorOf("beto")).toBe("NOT_YOUR_TURN");
    expect(stateOf("host").view.phase.kind).toBe("picking");
    expect(beto).toBeTruthy();
  });

  it("viewers can't play", async () => {
    const { code } = await startedGame();
    await app.connect("tv2", code);
    await send("tv2", { t: "hello" });
    await send("tv2", { t: "answer", choice: 0 });
    expect(errorOf("tv2")).toBe("NOT_A_PLAYER");
  });

  it("timeout pokes are judged by the server clock", async () => {
    const { ana, beto } = await startedGame();
    await send("ana", { t: "pick", cardId: stateOf("host").view.board[0]!.id });

    clock += 5_000;                                   // too early: ignored silently
    await send("host", { t: "timeout" });
    expect(stateOf("host").view.phase).toMatchObject({ answerer: ana.playerId });
    expect(errorOf("host")).toBeUndefined();

    clock += 5_000;                                   // deadline reached
    await send("host", { t: "timeout" });
    expect(stateOf("host").view.phase).toMatchObject({ answerer: beto.playerId, stake: 50 });
  });

  it("retries when another Lambda saved the room first (optimistic locking)", async () => {
    const { ana } = await startedGame();
    rooms.conflictsToSimulate = 2;                    // lose the race twice, then win
    await send("ana", { t: "pick", cardId: stateOf("host").view.board[0]!.id });
    expect(stateOf("host").view.phase).toMatchObject({ kind: "answering", answerer: ana.playerId });
  });

  it("gives up with BUSY rather than looping forever", async () => {
    await startedGame();
    rooms.conflictsToSimulate = 100;
    await send("ana", { t: "pick", cardId: stateOf("host").view.board[0]!.id });
    expect(errorOf("ana")).toBe("BUSY");
  });

  it("drops connections that vanished without $disconnect", async () => {
    const { code } = await startedGame();
    push.gone.add("beto");
    await send("host", { t: "timeout" });             // any broadcast trigger
    await send("ana", { t: "pick", cardId: stateOf("host").view.board[0]!.id });
    expect((await connections.listByRoom(code)).some((c) => c.connectionId === "beto")).toBe(false);
  });
});

describe("bad input", () => {
  it("answers garbage with BAD_MESSAGE", async () => {
    await app.connect("x", undefined);
    await app.message("x", "{nope");
    expect(errorOf("x")).toBe("BAD_MESSAGE");
  });

  it("needs a room for game messages", async () => {
    await app.connect("x", undefined);
    await send("x", { t: "join", name: "Ana" });
    expect(errorOf("x")).toBe("NO_ROOM");
  });
});

describe("picking categories", () => {
  it("a new room starts with every category picked", async () => {
    await createRoom();
    expect(stateOf("host").view.picks).toEqual(CATEGORIES.map((category) => ({ pack: "test", category })));
  });

  it("only the host changes them, only to categories that exist, and the deal follows them", async () => {
    const { code } = await createRoom();
    await joinAs("ana", code, "Ana");
    await send("ana", { t: "picks", picks: [{ pack: "test", category: "Dos" }] });
    expect(errorOf("ana")).toBe("NOT_HOST");

    await send("host", { t: "picks", picks: [{ pack: "test", category: "Cuatro" }] });
    expect(errorOf("host")).toBe("UNKNOWN_CATEGORY");

    await send("host", { t: "picks", picks: [{ pack: "test", category: "Dos" }] });
    expect(stateOf("ana").view.picks).toEqual([{ pack: "test", category: "Dos" }]);

    await send("host", { t: "start" });
    expect(new Set(stateOf("ana").view.board.map((c) => c.category))).toEqual(new Set(["Dos"]));
  });
});

describe("private packs", () => {
  it("a wrong code unlocks nothing and counts toward the room's cap", async () => {
    await createRoom();
    await send("host", { t: "unlock", code: "TAMALESABUELA25" });
    expect(errorOf("host")).toBe("BAD_CODE");
    expect(push.last("host", "unlocked")).toBeUndefined();
  });

  it("the right code (any form) unlocks the pack for this room: catalog, picks and the deal", async () => {
    const { code } = await createRoom();
    await joinAs("ana", code, "Ana");
    await send("host", { t: "unlock", code: "tamales abuela 26" });
    expect(push.last("host", "unlocked")).toEqual({ t: "unlocked", pack: { id: "familia", name: "Familia" } });
    expect(push.last("host", "catalog")!.packs.find((p) => p.id === "familia")).toMatchObject({ private: true });
    expect(stateOf("ana").view.picks).toContainEqual({ pack: "familia", category: "Viajes" });

    await send("host", { t: "picks", picks: [{ pack: "familia", category: "Viajes" }] });
    await send("host", { t: "start" });
    expect(new Set(stateOf("ana").view.board.map((c) => c.category))).toEqual(new Set(["Viajes"]));
  });

  it("stays private: other rooms and non-hosts never see it", async () => {
    const first = await createRoom();
    await send("host", { t: "unlock", code: CODE });

    await joinAs("ana", first.code, "Ana");
    await send("ana", { t: "catalog" });
    expect(push.last("ana", "catalog")!.packs.map((p) => p.id)).toEqual(["test"]);   // a player asking gets the public list
    await send("ana", { t: "unlock", code: CODE });
    expect(errorOf("ana")).toBe("NOT_HOST");

    await app.connect("lobby2", undefined);
    await send("lobby2", { t: "create" });
    const other = push.last("lobby2", "created")!;
    await app.connect("host2", other.room);
    await send("host2", { t: "hello", token: other.hostToken });
    await send("host2", { t: "catalog" });
    expect(push.last("host2", "catalog")!.packs.map((p) => p.id)).toEqual(["test"]);
    await send("host2", { t: "picks", picks: [{ pack: "familia", category: "Viajes" }] });
    expect(errorOf("host2")).toBe("UNKNOWN_CATEGORY");
  });

  it(`stops accepting codes after ${MAX_UNLOCK_FAILURES} wrong ones`, async () => {
    await createRoom();
    for (let i = 0; i < MAX_UNLOCK_FAILURES; i++) await send("host", { t: "unlock", code: `intento ${i}` });
    await send("host", { t: "unlock", code: CODE });   // even the right one, now
    expect(errorOf("host")).toBe("TOO_MANY_ATTEMPTS");
  });

  it("only in the lobby", async () => {
    const { code } = await createRoom();
    await joinAs("ana", code, "Ana");
    await send("host", { t: "start" });
    await send("host", { t: "unlock", code: CODE });
    expect(errorOf("host")).toBe("WRONG_PHASE");
  });
});

describe("house rules", () => {
  it("only the host changes them, in the lobby; everyone sees them", async () => {
    const { code } = await createRoom();
    await joinAs("ana", code, "Ana");
    await send("ana", { t: "rules", rules: { steals: "off" } });
    expect(errorOf("ana")).toBe("NOT_HOST");

    await send("host", { t: "rules", rules: { steals: "off", columns: 3 } });
    expect(stateOf("ana").view.rules).toMatchObject({ steals: "off", columns: 3 });

    await send("host", { t: "rules", rules: { columns: 42 } });
    expect(errorOf("host")).toBe("INVALID_RULES");
  });
});

describe("after the game", () => {
  async function onPodium() {
    const { code } = await createRoom();
    const ana = await joinAs("ana", code, "Ana");
    const beto = await joinAs("beto", code, "Beto");
    await send("host", { t: "start" });
    await send("host", { t: "end" });
    return { code, ana, beto };
  }

  it("players ask for another round; the host sees who", async () => {
    const { ana } = await onPodium();
    await send("ana", { t: "encore" });
    expect(stateOf("host").view.encore).toEqual([ana.playerId]);
    await send("host", { t: "encore" });
    expect(errorOf("host")).toBe("NOT_A_PLAYER");
  });

  it("rematch keeps whoever is still here; the one who left needs to join again", async () => {
    const { code, ana, beto } = await onPodium();
    await app.disconnect("beto");                        // Beto tapped "Salir"

    await send("ana", { t: "rematch" });
    expect(errorOf("ana")).toBe("NOT_HOST");
    await send("host", { t: "rematch" });

    const view = stateOf("host").view;
    expect(view.phase).toEqual({ kind: "lobby" });
    expect(view.players.map((p) => p.id)).toEqual([ana.playerId]);
    expect(view.scores).toEqual({ [ana.playerId]: 0 });

    // Beto's old token no longer seats him: he's a viewer and can join fresh.
    await app.connect("beto-again", code);
    await send("beto-again", { t: "hello", token: beto.token });
    expect(errorOf("beto-again")).toBe("BAD_TOKEN");
    expect(stateOf("beto-again").you).toEqual({ role: "viewer" });
  });

  it("the host can close the room from the lobby too", async () => {
    const { code } = await createRoom();
    await joinAs("ana", code, "Ana");
    await send("host", { t: "close" });
    expect(stateOf("ana").view.phase).toEqual({ kind: "closed" });
  });

  it("only the host closes the room, and everyone sees it closed", async () => {
    await onPodium();
    await send("beto", { t: "close" });
    expect(errorOf("beto")).toBe("NOT_HOST");
    await send("host", { t: "close" });
    expect(stateOf("ana").view.phase).toEqual({ kind: "closed" });
    expect(stateOf("beto").view.phase).toEqual({ kind: "closed" });
  });
});

describe("leaving", () => {
  it("in the lobby frees the seat, and the phone becomes a viewer", async () => {
    const { code } = await createRoom();
    const ana = await joinAs("ana", code, "Ana");
    await joinAs("beto", code, "Beto");
    await send("ana", { t: "leave" });
    expect(stateOf("host").view.players.map((p) => p.name)).toEqual(["Beto"]);
    expect(stateOf("ana").you).toEqual({ role: "viewer" });

    // The old token no longer seats them; the name is free again.
    await app.connect("ana-again", code);
    await send("ana-again", { t: "hello", token: ana.token });
    expect(errorOf("ana-again")).toBe("BAD_TOKEN");
    await send("ana-again", { t: "join", name: "Ana" });
    expect(push.last("ana-again", "joined")).toBeDefined();
  });

  it("mid-game keeps the score but skips their turns", async () => {
    const { code } = await createRoom();
    const ana = await joinAs("ana", code, "Ana");
    const beto = await joinAs("beto", code, "Beto");
    await send("host", { t: "start" });
    await send("ana", { t: "leave" });     // it was Ana's turn

    const view = stateOf("host").view;
    expect(view.left).toEqual([ana.playerId]);
    expect(view.players[view.turnOwner]!.id).toBe(beto.playerId);
    await send("ana", { t: "pick", cardId: view.board[0]!.id });
    expect(errorOf("ana")).toBe("NOT_A_PLAYER");
  });

  it("only players can leave", async () => {
    await createRoom();
    await send("host", { t: "leave" });
    expect(errorOf("host")).toBe("NOT_A_PLAYER");
  });
});
