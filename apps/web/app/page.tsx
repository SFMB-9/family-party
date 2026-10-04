"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { isRoomCode, type ServerMessage } from "@family-party/protocol";
import { describeError } from "./lib/errors";
import { tokenStore } from "./lib/storage";
import { NerdsButton } from "./nerds";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  // A "lobby" connection (no room yet), used only to create the room. Categories are picked inside the room.
  useEffect(() => {
    if (!WS_URL) return;
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;
    ws.onopen = () => setReady(true);
    ws.onmessage = (event: MessageEvent<string>) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.t === "created") {
        tokenStore.set(msg.room, "host", msg.hostToken);
        router.push(`/host/${msg.room}`);
      } else if (msg.t === "error") {
        setError(msg.error);
        setCreating(false);
      }
    };
    return () => ws.close();
  }, [router]);

  const create = () => {
    setCreating(true);
    setError(null);
    socketRef.current?.send(JSON.stringify({ t: "create" }));
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/play/${code}`);
  };


  return (
    <div className="stage" data-stage="board">
    <main className="shell home">
      <header className="hero">
        <h1 className="logo big">Family Party</h1>
        <p className="tagline">Trivia en familia, desde el celular</p>
      </header>

      <section className="panel">
        <h2 className="pixel-title small">Unirse a una sala</h2>
        <form className="join-code" onSubmit={join}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
            placeholder="ABCD"
            inputMode="text"
            autoCapitalize="characters"
            aria-label="Código de sala"
          />
          <button className="btn" type="submit" disabled={!isRoomCode(code)}>Entrar</button>
        </form>
      </section>

      <section className="panel">
        <h2 className="pixel-title small">Crear una sala</h2>
        <p className="hint">Ábrelo en la pantalla que todos verán (la tele, o la que compartas en Discord). Las preguntas y reglas se eligen en la sala.</p>
        <p className="hint warn phone-only">
          Desde el celular funciona, pero el tablero se ve mejor en una pantalla grande.
        </p>
        {error && <p className="notice error">{describeError(error)}</p>}
        <button className="btn big" disabled={!ready || creating} onClick={create}>
          {creating ? "Creando…" : "Crear sala"}
        </button>
      </section>
    </main>
    <NerdsButton />
    </div>
  );
}
