"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Mirrors `Envelope` in services/game-session/src/envelope.ts. */
export interface Envelope {
  from: string;
  at: number;
  data: string;
}

export type Status = "connecting" | "open" | "closed";

/**
 * One WebSocket per page. Reconnects automatically with backoff, because
 * phones drop connections all the time (screen locks, Wi-Fi ↔ 4G switches).
 */
export function useSocket(url: string | undefined) {
  const [status, setStatus] = useState<Status>("connecting");
  const [messages, setMessages] = useState<Envelope[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!url) return;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      setStatus("connecting");
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setStatus("open");
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const envelope = JSON.parse(event.data) as Envelope;
          setMessages((prev) => [...prev.slice(-99), envelope]); // keep the last 100
        } catch {
          // Not an envelope (e.g. an API Gateway error frame). Ignore it.
        }
      };

      ws.onclose = () => {
        setStatus("closed");
        if (stopped) return;
        // 1s, 2s, 4s… capped at 15s
        const delay = Math.min(15_000, 1_000 * 2 ** retry++);
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [url]);

  const send = useCallback((text: string) => {
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN && text.trim()) ws.send(text.trim());
  }, []);

  return { status, messages, send };
}
