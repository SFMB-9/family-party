"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { isRoomCode, type PackInfo, type ServerMessage } from "@family-party/protocol";
import { describeError } from "./lib/errors";
import { tokenStore } from "./lib/storage";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL;

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [packs, setPacks] = useState<PackInfo[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  // A "lobby" connection (no room yet): fetch the catalog, and later create the room.
  useEffect(() => {
    if (!WS_URL) return;
    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: "catalog" }));
    ws.onmessage = (event: MessageEvent<string>) => {
      const msg = JSON.parse(event.data) as ServerMessage;
      if (msg.t === "catalog") {
        setPacks(msg.packs);
        setChosen(new Set(msg.packs.flatMap((p) => p.categories.map((c) => c.name))));
      } else if (msg.t === "created") {
        tokenStore.set(msg.room, "host", msg.hostToken);
        router.push(`/host/${msg.room}`);
      } else if (msg.t === "error") {
        setError(msg.error);
        setCreating(false);
      }
    };
    return () => ws.close();
  }, [router]);

  const toggle = (category: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const create = () => {
    setCreating(true);
    setError(null);
    socketRef.current?.send(JSON.stringify({ t: "create", categories: [...chosen] }));
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/play/${code}`);
  };

  const categories = packs?.flatMap((p) => p.categories.map((c) => ({ ...c, pack: p.name }))) ?? [];

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
        <p className="hint">Abre esto en la pantalla que todos verán (la tele, o la que compartas en Discord).</p>
        {!packs && <p className="hint">Cargando categorías…</p>}
        <div className="chips">
          {categories.map((c) => (
            <button key={`${c.pack}-${c.name}`} className={`chip ${chosen.has(c.name) ? "on" : ""}`} onClick={() => toggle(c.name)}>
              {c.name} <small>{c.count}</small>
            </button>
          ))}
        </div>
        {error && <p className="notice error">{describeError(error)}</p>}
        <button className="btn big" disabled={!packs || chosen.size === 0 || creating} onClick={create}>
          {creating ? "Creando…" : "Crear sala"}
        </button>
      </section>
    </main>
    </div>
  );
}
