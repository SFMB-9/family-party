"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upgradeView } from "@family-party/game-core";
import type { ClientMessage, PackInfo, ServerMessage } from "@family-party/protocol";
import { tokenStore } from "./storage";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

export type Status = "connecting" | "open" | "reconnecting" | "not-found";
/** How the connection feels right now, from heartbeat round trips. */
export type Quality = "good" | "slow" | "bad";

const PING_EVERY_MS = 20_000;   // well under API Gateway's 10-minute idle timeout
const PONG_WAIT_MS = 8_000;     // no answer by then: one missed beat
const SLOW_MS = 600;            // round trip above this feels laggy in a quiz
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
  const [quality, setQuality] = useState<Quality>("good");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<PackInfo[] | null>(null); // asked for by the host lobby
  const [unlocked, setUnlocked] = useState<{ id: string; name: string } | null>(null); // last pack a code opened
  const socketRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false); // room closed: no point keeping the heartbeat

  useEffect(() => {
    if (!WS_URL) return;
    let stopped = false;
    let retry = 0;
    let refusedInARow = 0;
    let joinedOnce = false; // got a snapshot: the room exists, so later failures are network, not "not found"
    let timer: ReturnType<typeof setTimeout> | undefined;

    // ---- heartbeat: one ping in flight at a time, only while the page is visible
    let pingTimer: ReturnType<typeof setTimeout> | undefined;
    let pongTimer: ReturnType<typeof setTimeout> | undefined;
    let sentAt: number | null = null;
    let missed = 0;

    const stopHeartbeat = () => {
      clearTimeout(pingTimer);
      clearTimeout(pongTimer);
      sentAt = null;
    };
    const ping = () => {
      stopHeartbeat();
      const ws = socketRef.current;
      // Hidden tab, sleeping phone or closed room: no pings, no cost. Resumes on visibilitychange.
      if (ws?.readyState !== WebSocket.OPEN || document.visibilityState !== "visible" || closedRef.current) return;
      sentAt = Date.now();
      ws.send(JSON.stringify({ t: "ping" }));
      pongTimer = setTimeout(() => {
        missed++;
        setQuality(missed >= 2 ? "bad" : "slow");
        // Two silent beats: the socket is probably dead (phone slept, network switched). Reconnect.
        if (missed >= 2) ws.close();
        else ping();
      }, PONG_WAIT_MS);
    };
    const onPong = (serverTime: number) => {
      if (sentAt === null) return;
      const rtt = Date.now() - sentAt;
      stopHeartbeat();
      missed = 0;
      setLatencyMs(rtt);
      setQuality(rtt > SLOW_MS ? "slow" : "good");
      setClockOffset(serverTime + rtt / 2 - Date.now());
      pingTimer = setTimeout(ping, PING_EVERY_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") ping();
      else stopHeartbeat();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Back online (phone left the elevator): retry now instead of waiting out the backoff.
    const onOnline = () => {
      if (stopped || socketRef.current?.readyState === WebSocket.OPEN) return;
      clearTimeout(timer);
      retry = 0;
      connect();
    };
    window.addEventListener("online", onOnline);

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
        missed = 0;
        setQuality("good");
        ping();
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.t === "state") {
          // The server may be one deploy behind the web app (Vercel ships first): fill in new fields.
          joinedOnce = true;
          const view = upgradeView(msg.view);
          closedRef.current = view.phase.kind === "closed";
          setState({ ...msg, view });
          setClockOffset(msg.serverTime - Date.now());
          setError(null);
        } else if (msg.t === "catalog") {
          setCatalog(msg.packs);
        } else if (msg.t === "unlocked") {
          setUnlocked(msg.pack);
        } else if (msg.t === "pong") {
          onPong(msg.serverTime);
        } else if (msg.t === "joined") {
          tokenStore.set(code, "player", msg.token);
        } else if (msg.t === "error") {
          if (msg.error === "BAD_TOKEN") tokenStore.clear(code, kind); // stale seat: start fresh
          setError(msg.error);
        }
      };

      ws.onclose = () => {
        stopHeartbeat();
        if (stopped) return;
        setQuality("bad");
        // $connect returns 403 for unknown rooms: the socket closes without ever opening.
        // A browser can't tell that apart from "server unreachable", so only conclude "not found"
        // for a room we never got into, while the device says it's online.
        if (!opened && !joinedOnce && navigator.onLine && ++refusedInARow >= 2) return setStatus("not-found");
        setStatus("reconnecting");
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stopHeartbeat();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      socketRef.current?.close();
    };
  }, [code, kind]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = socketRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    setError(null); // a new action: an error from now on is about this one
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  return { status, state, error, send, clockOffset, quality, latencyMs, catalog, unlocked, missingConfig: !WS_URL };
}
