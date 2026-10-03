"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Board, Podium, QuestionPanel, Scoreboard, nameOf } from "../../components";
import { describeError } from "../../lib/errors";
import { useCountdown } from "../../lib/useCountdown";
import { useRoom } from "../../lib/useRoom";

/**
 * The phone. Fully playable on its own: the question and options are always here,
 * so nobody depends on a laggy Discord stream to read them.
 */
export default function PlayPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const { status, state, error, send, clockOffset, missingConfig } = useRoom(code, "player");
  const secondsLeft = useCountdown(state?.view.phase, clockOffset, send);
  const [name, setName] = useState("");

  if (missingConfig) return <main className="shell"><p className="empty">Falta NEXT_PUBLIC_WS_URL.</p></main>;
  if (status === "not-found") return <main className="shell"><p className="empty">La sala {code} no existe o ya expiró.</p></main>;
  if (!state) return <main className="shell"><p className="empty">Conectando…</p></main>;

  const { view, connected, you } = state;
  const me = you.playerId;
  const myTurn = view.phase.kind === "picking" && view.players[view.turnOwner]?.id === me;
  const myAnswer = view.phase.kind === "answering" && view.phase.answerer === me;

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    send({ t: "join", name });
  };

  return (
    <main className="shell phone">
      <header className="top">
        <h1>Family Party</h1>
        <span className="room-code small">{code}</span>
        <span className={`status status-${status}`}>{status === "open" ? (me ? nameOf(view, me) : "Conectado") : "Reconectando…"}</span>
      </header>

      {error && <p className="notice error">{describeError(error)}</p>}

      {!me && view.phase.kind === "lobby" && (
        <form className="join" onSubmit={onJoin}>
          <label htmlFor="name">¿Cómo te llamas?</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="nickname" autoFocus />
          <button className="primary big" type="submit" disabled={!name.trim()}>Unirme</button>
        </form>
      )}

      {!me && view.phase.kind !== "lobby" && view.phase.kind !== "gameOver" && (
        <p className="notice">La partida ya empezó. Puedes mirar desde aquí.</p>
      )}

      {me && view.phase.kind === "lobby" && (
        <section className="waiting">
          <p>¡Listo! Esperando a que el anfitrión empiece…</p>
          <Scoreboard view={view} connected={connected} me={me} />
        </section>
      )}

      {view.phase.kind === "picking" && (
        <section>
          <p className={`banner ${myTurn ? "mine" : ""}`}>
            {myTurn ? "¡Tu turno! Elige una carta" : <>Turno de <strong>{nameOf(view, view.players[view.turnOwner]?.id)}</strong></>}
          </p>
          <Board view={view} {...(myTurn && { onPick: (cardId: string) => send({ t: "pick", cardId }) })} />
        </section>
      )}

      {view.phase.kind === "answering" && (
        <QuestionPanel
          view={view}
          secondsLeft={secondsLeft}
          canAnswer={myAnswer}
          onAnswer={(choice) => send({ t: "answer", choice })}
        />
      )}

      {me && (view.phase.kind === "picking" || view.phase.kind === "answering") && (
        <Scoreboard view={view} connected={connected} me={me} />
      )}

      {view.phase.kind === "gameOver" && <Podium view={view} />}
    </main>
  );
}
