import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Question } from "@family-party/game-core";
import { createApp } from "./app";
import { MemoryConnections, MemoryPush, MemoryRooms } from "./memory";

// ---------------------------------------------------------------- test harness

/** 3 categories × 4 questions, 10s timer, answer "A" is always right. */
const BANK: Question[] = ["Uno", "Dos", "Tres"].flatMap((category) =>
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

let rooms: MemoryRooms;
let connections: MemoryConnections;
let push: MemoryPush;
let clock: number;
let counter: number;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
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
    questions: () => BANK,
    catalog: () => [{ id: "test", name: "Test", description: "", categories: [{ name: "Uno", count: 4 }] }],
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
