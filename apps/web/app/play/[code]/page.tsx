"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Board, Podium, QuestionPanel, REVEAL_MS, Reveal, Scoreboard, money, nameOf, stageOf, useServerNow } from "../../components";
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
  const [dismissed, setDismissed] = useState<number | null>(null);
  const reveal = state?.view.reveal;
  const serverNow = useServerNow(clockOffset, !!reveal);

  if (missingConfig) return <Message text="Falta NEXT_PUBLIC_WS_URL." />;
  if (status === "not-found") return <Message text={`La sala ${code} no existe o ya expiró.`} />;
  if (!state) return <Message text="Conectando…" />;

  const { view, connected, you } = state;
  const me = you.playerId;
  const myTurn = view.phase.kind === "picking" && view.players[view.turnOwner]?.id === me;
  const myAnswer = view.phase.kind === "answering" && view.phase.answerer === me;
  const myScore = me ? view.scores[me] ?? 0 : 0;
  const revealing = !!reveal && reveal.closedAt !== dismissed && serverNow - reveal.closedAt <= REVEAL_MS;

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    send({ t: "join", name });
  };

  return (
    <div className="stage" data-stage={stageOf(view.phase)}>
      <main className="shell phone">
        <header className="top">
          <h1 className="logo small">Family Party</h1>
          <span className="room-code small">{code}</span>
        </header>

        {status !== "open" && <p className="notice">Reconectando…</p>}
        {error && <p className="notice error">{describeError(error)}</p>}

        {me && view.phase.kind !== "lobby" && (
          <p className="me-bar">
            <span>{nameOf(view, me)}</span>
            <span className="score">{money(myScore)}</span>
          </p>
        )}

        {!me && view.phase.kind === "lobby" && (
          <form className="panel join" onSubmit={onJoin}>
            <label htmlFor="name" className="pixel-title small">¿Cómo te llamas?</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="nickname" autoFocus />
            <button className="btn big" type="submit" disabled={!name.trim()}>Unirme</button>
          </form>
        )}

        {!me && view.phase.kind !== "lobby" && view.phase.kind !== "gameOver" && (
          <p className="notice">La partida ya empezó. Puedes mirar desde aquí.</p>
        )}

        {me && view.phase.kind === "lobby" && (
          <section className="waiting">
            <p className="pixel-title small">¡Listo!</p>
            <p className="hint">Esperando a que el anfitrión empiece…</p>
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
          <>
            {myAnswer && view.phase.tried.length > 0 && <p className="banner mine">¡Puedes robar esta pregunta!</p>}
            <QuestionPanel view={view} secondsLeft={secondsLeft} canAnswer={myAnswer} onAnswer={(choice) => send({ t: "answer", choice })} />
          </>
        )}

        {me && (view.phase.kind === "picking" || view.phase.kind === "answering") && (
          <Scoreboard view={view} connected={connected} me={me} />
        )}

        {view.phase.kind === "gameOver" && !revealing && <Podium view={view} />}
      </main>

      {revealing && <Reveal view={view} serverNow={serverNow} onClose={() => setDismissed(reveal!.closedAt)} />}
    </div>
  );
}

function Message({ text }: { text: string }) {
  return (
    <div className="stage" data-stage="lobby">
      <main className="shell"><p className="empty">{text}</p></main>
    </div>
  );
}
