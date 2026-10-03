"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@family-party/protocol";
import { tokenStore } from "./storage";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

export type Status = "connecting" | "open" | "reconnecting" | "not-found";
export type RoomState = Extract<ServerMessage, { t: "state" }>;
type Kind = "host" | "player";

/**
 * One room connection: opens wss://…?room=CODE, says hello with the saved token,
 * and keeps the latest snapshot. Reconnects with backoff; the token restores the same seat.
 */
export function useRoom(code: string, kind: Kind) {
  const [status, setStatus] = useState<Status>("connecting");
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0); // serverTime - localTime
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!WS_URL) return;
    let stopped = false;
    let retry = 0;
    let refusedInARow = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(`${WS_URL}?room=${encodeURIComponent(code)}`);
      socketRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        retry = 0;
        refusedInARow = 0;
        setStatus("open");
        // The server can't push during $connect, so the client asks for the snapshot.
        const token = tokenStore.get(code, kind);
        ws.send(JSON.stringify(token ? { t: "hello", token } : { t: "hello" }));
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === "state") {
          setState(msg);
          setClockOffset(msg.serverTime - Date.now());
          setError(null);
        } else if (msg.t === "joined") {
          tokenStore.set(code, "player", msg.token);
        } else if (msg.t === "error") {
          if (msg.error === "BAD_TOKEN") tokenStore.clear(code, kind); // stale seat: start fresh
          setError(msg.error);
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        // $connect returns 403 for unknown rooms: the socket closes without ever opening.
        if (!opened && ++refusedInARow >= 2) return setStatus("not-found");
        setStatus("reconnecting");
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [code, kind]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { status, state, error, send, clockOffset, missingConfig: !WS_URL };
}
