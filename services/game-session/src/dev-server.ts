/**
 * Local game server: the same app.ts as the Lambda, with in-memory storage
 * instead of DynamoDB and a plain WebSocket server instead of API Gateway.
 *
 *   pnpm --filter @family-party/game-session dev
 *   then in apps/web/.env.local:  NEXT_PUBLIC_WS_URL=ws://localhost:8787
 *
 * Restarting it wipes all rooms. Never deployed: not imported by handler.ts.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { catalog, selectQuestions } from "@family-party/question-bank";
import { createApp } from "./app";
import { MemoryConnections, MemoryRooms } from "./memory";

const PORT = Number(process.env.PORT ?? 8787);
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
  questions: (selection) => selectQuestions(selection),
  catalog: () => catalog(),
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
