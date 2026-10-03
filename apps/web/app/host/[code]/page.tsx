"use client";

import { useParams } from "next/navigation";
import { Board, Podium, QuestionPanel, Scoreboard, hueFor, nameOf } from "../../components";
import { describeError } from "../../lib/errors";
import { useCountdown } from "../../lib/useCountdown";
import { useRoom } from "../../lib/useRoom";

/** The shared screen: TV in the living room, or a Discord screen share. */
export default function HostPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const { status, state, error, send, clockOffset, missingConfig } = useRoom(code, "host");
  const secondsLeft = useCountdown(state?.view.phase, clockOffset, send);

  if (missingConfig) return <main className="shell"><p className="empty">Falta NEXT_PUBLIC_WS_URL.</p></main>;
  if (status === "not-found") return <main className="shell"><p className="empty">La sala {code} no existe o ya expiró.</p></main>;
  if (!state) return <main className="shell"><p className="empty">Conectando a la sala {code}…</p></main>;

  const { view, connected, you } = state;
  const isHost = you.role === "host";
  const joinUrl = typeof window !== "undefined" ? `${window.location.host}/play/${code}` : "";

  return (
    <main className="shell host">
      <header className="top">
        <h1>Family Party</h1>
        <div className="room-code" title="Código de la sala">{code}</div>
        <span className={`status status-${status}`}>{status === "open" ? "En línea" : "Reconectando…"}</span>
      </header>

      {!isHost && <p className="notice">Estás viendo esta sala. Solo quien la creó puede iniciarla.</p>}
      {error && <p className="notice error">{describeError(error)}</p>}

      {view.phase.kind === "lobby" && (
        <section className="lobby">
          <p className="join-hint">
            Entra desde tu celular a <strong>{joinUrl}</strong>
            <br />o abre la página principal y escribe el código <strong>{code}</strong>
          </p>
          <ul className="lobby-players">
            {view.players.length === 0 && <li className="empty">Esperando jugadores…</li>}
            {view.players.map((p) => (
              <li key={p.id} style={{ ["--hue" as string]: hueFor(p.id) }}>
                <span className={`dot ${connected.includes(p.id) ? "on" : "off"}`} />
                {p.name}
              </li>
            ))}
          </ul>
          {isHost && (
            <button className="primary big" disabled={view.players.length === 0} onClick={() => send({ t: "start" })}>
              Empezar ({view.players.length} {view.players.length === 1 ? "jugador" : "jugadores"})
            </button>
          )}
        </section>
      )}

      {(view.phase.kind === "picking" || view.phase.kind === "answering") && (
        <div className="game">
          <div className="main-col">
            {view.phase.kind === "picking" && (
              <p className="banner">
                Turno de <strong>{nameOf(view, view.players[view.turnOwner]?.id)}</strong>: elige una carta en tu celular
              </p>
            )}
            {view.phase.kind === "answering" ? (
              <QuestionPanel view={view} secondsLeft={secondsLeft} canAnswer={false} />
            ) : (
              <Board view={view} />
            )}
          </div>
          <aside>
            <Scoreboard view={view} connected={connected} />
          </aside>
        </div>
      )}

      {view.phase.kind === "gameOver" && <Podium view={view} />}
    </main>
  );
}
