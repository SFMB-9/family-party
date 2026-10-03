"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Announcement, Avatar, Board, Podium, QuestionPanel, REVEAL_MS, Reveal, Scoreboard, stageOf, useServerNow } from "../../components";
import { describeError } from "../../lib/errors";
import { useCountdown } from "../../lib/useCountdown";
import { useRoom } from "../../lib/useRoom";

/** The shared screen: TV in the living room, or a Discord screen share. */
export default function HostPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const { status, state, error, send, clockOffset, missingConfig } = useRoom(code, "host");
  const secondsLeft = useCountdown(state?.view.phase, clockOffset, send);
  const reveal = state?.view.reveal;
  const serverNow = useServerNow(clockOffset, !!reveal);
  const revealing = !!reveal && serverNow - reveal.closedAt <= REVEAL_MS;

  if (missingConfig) return <Message text="Falta NEXT_PUBLIC_WS_URL." />;
  if (status === "not-found") return <Message text={`La sala ${code} no existe o ya expiró.`} />;
  if (!state) return <Message text={`Conectando a la sala ${code}…`} />;

  const { view, connected, you } = state;
  const isHost = you.role === "host";
  const playing = view.phase.kind === "picking" || view.phase.kind === "answering";
  const joinUrl = typeof window !== "undefined" ? `${window.location.host}/play/${code}` : "";

  return (
    <div className="stage host-screen" data-stage={stageOf(view.phase)}>
      <main className="shell host">
        <header className="top">
          <h1 className="logo">Family Party</h1>
          <div className="room-code" title="Código de la sala">{code}</div>
          <div className="top-right">
            {isHost && playing && <EndButton onEnd={() => send({ t: "end" })} />}
            <span className={`status status-${status}`}>{status === "open" ? "En línea" : "Reconectando…"}</span>
          </div>
        </header>

        {!isHost && <p className="notice">Estás viendo esta sala. Solo quien la creó puede iniciarla.</p>}
        {error && <p className="notice error">{describeError(error)}</p>}

        {view.phase.kind === "lobby" && (
          <section className="lobby">
            <div className="lobby-join">
              <p className="pixel-title">Únete desde tu celular</p>
              <p className="join-url">{joinUrl}</p>
              <p className="hint">o abre la página principal y escribe el código</p>
              <p className="room-code huge">{code}</p>
            </div>
            <div className="lobby-roster">
              <p className="pixel-title small">Jugadores ({view.players.length}/10)</p>
              <ul className="roster">
                {Array.from({ length: 10 }, (_, i) => view.players[i]).map((p, i) =>
                  p ? (
                    <li key={p.id} className={connected.includes(p.id) ? "" : "away"} title={p.name}>
                      <Avatar id={p.id} name={p.name} size={72} />
                      <span>{p.name}</span>
                    </li>
                  ) : (
                    <li key={`empty-${i}`} className="empty-slot" aria-hidden />
                  ),
                )}
              </ul>
              {isHost && (
                <button className="btn big" disabled={view.players.length === 0} onClick={() => send({ t: "start" })}>
                  Jugar
                </button>
              )}
            </div>
          </section>
        )}

        {(view.phase.kind === "picking" || view.phase.kind === "answering") && (
          <div className="game">
            <div className="main-col">
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

        {view.phase.kind === "gameOver" && !revealing && <Podium view={view} />}
      </main>

      <Reveal view={view} serverNow={serverNow} />
      <Announcement view={view} holdWhile={revealing} />
    </div>
  );
}

/**
 * Two taps, no dialog: "Terminar" turns into "¿Terminar ya? Sí / No" for a few seconds.
 * Ending can't be undone, so it gets the one confirmation in the game.
 */
function EndButton({ onEnd }: { onEnd: () => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 4_000);
    return () => clearTimeout(t);
  }, [asking]);

  if (!asking) {
    return <button className="btn small quiet" onClick={() => setAsking(true)}>Terminar</button>;
  }
  return (
    <span className="end-confirm" role="group" aria-label="Confirmar fin de partida">
      <span className="pixel-title small">¿Terminar ya?</span>
      <button className="btn small danger" onClick={onEnd}>Sí</button>
      <button className="btn small" onClick={() => setAsking(false)}>No</button>
    </span>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="stage" data-stage="lobby">
      <main className="shell"><p className="empty">{text}</p></main>
    </div>
  );
}
