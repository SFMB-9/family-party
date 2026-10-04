/**
 * Local game server: the same app.ts as the Lambda, with in-memory storage
 * instead of DynamoDB and a plain WebSocket server instead of API Gateway.
 *
 *   pnpm --filter @family-party/game-session dev
 *   then in apps/web/.env.local:  NEXT_PUBLIC_WS_URL=ws://localhost:8787
 *   (TIME_LIMIT_SEC=6 pnpm … dev  to make every timer short)
 *
 * Restarting it wipes all rooms. Never deployed: not imported by handler.ts.
 *
 * Private packs: PRIVATE_PACKS_DIR=C:\path\outside\the\repo  (locked .json files, see scripts/lock-pack.ts)
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { PACKS, catalogWith, defaultPicks, picksExist, selectQuestions } from "@family-party/question-bank";
import { FolderPacks } from "./fs-packs";
import { verifyCode } from "./packs";
import { noPrivatePacks } from "./s3";
import { createApp } from "./app";
import { MemoryConnections, MemoryRooms } from "./memory";

const PORT = Number(process.env.PORT ?? 8787);
/** Optional: TIME_LIMIT_SEC=6 shortens every timed question, handy for testing timeouts and steals. */
const TIME_LIMIT_MS = process.env.TIME_LIMIT_SEC ? Number(process.env.TIME_LIMIT_SEC) * 1000 : null;
const sockets = new Map<string, WebSocket>();

const app = createApp({
  rooms: new MemoryRooms(),
  connections: new MemoryConnections(),
  push: {
    async send(connectionId, message) {
      const socket = sockets.get(connectionId);
      if (!socket || socket.readyState !== socket.OPEN) return "gone";
      socket.send(JSON.stringify(message));
      return "ok";
    },
  },
  now: () => Date.now(),
  randomInt: (max) => randomInt(max),
  randomToken: () => randomBytes(24).toString("base64url"),
  hash: (token) => createHash("sha256").update(token).digest("hex"),
  questions: (selection, extra) =>
    selectQuestions(selection, [...PACKS, ...extra]).map((q) => (TIME_LIMIT_MS && q.timeLimitMs ? { ...q, timeLimitMs: TIME_LIMIT_MS } : q)),
  catalog: (extra) => catalogWith(extra),
  defaultPicks: () => defaultPicks(),
  picksExist: (picks, extra) => picksExist(picks, [...PACKS, ...extra]),
  privatePacks: process.env.PRIVATE_PACKS_DIR ? new FolderPacks(process.env.PRIVATE_PACKS_DIR) : noPrivatePacks,
  verifyCode,
});

const server = new WebSocketServer({ port: PORT });

server.on("connection", async (socket, request) => {
  const connectionId = randomBytes(6).toString("hex");
  const room = new URL(request.url ?? "/", "http://localhost").searchParams.get("room") ?? undefined;
  sockets.set(connectionId, socket);

  // Same contract as API Gateway's $connect: refuse unknown rooms.
  if (!(await app.connect(connectionId, room))) {
    sockets.delete(connectionId);
    socket.close(1008, "room not found");
    return;
  }

  socket.on("message", (data) => void app.message(connectionId, data.toString()));
  socket.on("close", () => {
    sockets.delete(connectionId);
    void app.disconnect(connectionId);
  });
});

console.log(`family-party dev server on ws://localhost:${PORT}`);
// Say which private packs loaded, so a missing PRIVATE_PACKS_DIR doesn't look like a wrong code.
if (!process.env.PRIVATE_PACKS_DIR) console.log("private packs: none (set PRIVATE_PACKS_DIR to test them)");
else
  new FolderPacks(process.env.PRIVATE_PACKS_DIR)
    .list()
    .then((packs) => console.log(`private packs: ${packs.length} in ${process.env.PRIVATE_PACKS_DIR}` + (packs.length ? ` (${packs.map((p) => p.pack.id).join(", ")})` : "")))
    .catch((e: Error) => console.warn(`private packs: can't read ${process.env.PRIVATE_PACKS_DIR}: ${e.message}`));
