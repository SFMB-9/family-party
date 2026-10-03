"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSocket, type Status } from "./useSocket";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

const STATUS_LABEL: Record<Status, string> = {
  connecting: "Conectando…",
  open: "Conectado",
  closed: "Desconectado. Reintentando…",
};

/** Same connection id → same hue, so each device gets a stable color. */
function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export default function Home() {
  const { status, messages, send } = useSocket(WS_URL);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft("");
  };

  if (!WS_URL) {
    return (
      <main className="shell">
        <p className="empty">
          Falta <code>NEXT_PUBLIC_WS_URL</code>. Copia <code>.env.example</code> a <code>.env.local</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="top">
        <h1>Family Party</h1>
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
      </header>

      <ol className="feed">
        {messages.length === 0 && <li className="empty">Escribe algo. Todos los dispositivos conectados lo verán.</li>}
        {messages.map((m) => (
          <li key={`${m.from}-${m.at}`} className="msg" style={{ ["--hue" as string]: hueFor(m.from) }}>
            <span className="who">{m.from.slice(0, 4)}</span>
            <span className="text">{m.data}</span>
            <time className="when">{new Date(m.at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
          </li>
        ))}
        <div ref={bottomRef} />
      </ol>

      <form className="composer" onSubmit={onSubmit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Mensaje"
          maxLength={1000}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" disabled={status !== "open" || !draft.trim()}>
          Enviar
        </button>
      </form>
    </main>
  );
}
