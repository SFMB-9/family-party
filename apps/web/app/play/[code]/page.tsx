"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import {
  Board, ConfirmButton, WaitingLine, ConnectionDot, CopyText, Podium, QuestionPanel, Reveal, RoomClosed, Roulette, RulesSummary, Scoreboard, money, nameOf, stageOf, useOpening, useServerNow, revealShowing,
} from "../../components";
import { describeError } from "../../lib/errors";
import { useCountdown } from "../../lib/useCountdown";
import { tokenStore } from "../../lib/storage";
import { useRoom } from "../../lib/useRoom";
import { BRAND } from "../../brand";

/**
 * The phone. Fully playable on its own: the question and options are always here,
 * so nobody depends on a laggy Discord stream to read them.
 */
export default function PlayPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const { status, state, error, send, clockOffset, quality, latencyMs, missingConfig } = useRoom(code, "player");
  const secondsLeft = useCountdown(state?.view.phase, clockOffset, send);
  const [name, setName] = useState("");
  const [dismissed, setDismissed] = useState<number | null>(null);
  const reveal = state?.view.reveal;
  const serverNow = useServerNow(clockOffset, !!reveal);
  const router = useRouter();
  const forget = useCallback(() => tokenStore.clear(code, "player"), [code]);
  const opening = useOpening(state?.view);

  if (missingConfig) return <Message text="Falta NEXT_PUBLIC_WS_URL." />;
  if (status === "not-found") return <Message text={`La sala ${code} no existe o ya expiró.`} />;
  if (!state) return <Message text="Conectando…" />;

  const { view, connected, you } = state;
  const me = you.playerId;
  // Joined mid-game: watching until the host taps "Otra ronda".
  const inLine = !!me && view.waiting.some((p) => p.id === me);
  const seated = !!me && !inLine;
  const playing = view.phase.kind === "picking" || view.phase.kind === "answering";
  const myTurn = view.phase.kind === "picking" && view.players[view.turnOwner]?.id === me;
  const myAnswer = view.phase.kind === "answering" && view.phase.answerer === me;
  const myScore = me ? view.scores[me] ?? 0 : 0;
  const revealing = revealShowing(view, serverNow, dismissed);

  /**
   * Leaving gives up the seat. In the lobby the name frees up; mid-game this phone drops out of
   * the turn order (its score stays on the podium). Offline, the seat just goes quiet until a rematch.
   */
  const leave = () => {
    if (me) send({ t: "leave" });
    forget();
    router.push("/");
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    send({ t: "join", name });
  };

  return (
    <div className="stage" data-stage={stageOf(view.phase)}>
      <main className="shell phone">
        <header className="top">
          <h1 className="logo small">{BRAND}</h1>
          <span className="top-right">
          <ConnectionDot quality={quality} status={status} latencyMs={latencyMs} label={false} />
          <CopyText
            className="room-code small"
            text={code}
            copy={typeof window !== "undefined" ? `${window.location.origin}/play/${code}` : code}
            label="el enlace de la sala"
            icon
            share={{
              title: BRAND,
              text: `¡Únete a la partida! Sala ${code}`,
              url: typeof window !== "undefined" ? `${window.location.origin}/play/${code}` : "",
            }}
          />
          </span>
        </header>

        {status !== "open" && <p className="notice">Reconectando…</p>}
        {error && <p className="notice error">{describeError(error)}</p>}

        {seated && view.phase.kind !== "lobby" && view.phase.kind !== "closed" && (
          <p className="me-bar">
            <span>{nameOf(view, me)}</span>
            <span className="score">{money(myScore)}</span>
          </p>
        )}

        {!me && view.phase.kind !== "closed" && (
          <form className="panel join" onSubmit={onJoin}>
            {view.phase.kind === "lobby"
              ? <label htmlFor="name" className="pixel-title small">¿Cómo te llamas?</label>
              : <>
                  <p className="pixel-title small">La partida ya empezó</p>
                  <label htmlFor="name" className="hint">Escribe tu nombre y entras en la siguiente ronda. Mientras, puedes mirar.</label>
                </>}
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="nickname" autoFocus />
            <button className="btn big" type="submit" disabled={!name.trim()}>{view.phase.kind === "lobby" ? "Unirme" : "Apuntarme"}</button>
          </form>
        )}

        {inLine && view.phase.kind !== "closed" && (
          <section className="in-line">
            <p className="banner">Estás en la fila, {nameOf(view, me)}</p>
            <p className="hint">Entras cuando el anfitrión empiece otra ronda. Mientras, mira el juego.</p>
            <div className="leave-row">
              <ConfirmButton label="Salir" question="¿Salir de la fila?" onConfirm={leave} />
            </div>
          </section>
        )}

        {me && view.phase.kind === "lobby" && (
          <section className="waiting">
            <p className="pixel-title small">¡Listo!</p>
            <p className="hint">Esperando a que el anfitrión empiece…</p>
            <Scoreboard view={view} connected={connected} me={me} />
            <RulesSummary rules={view.rules} picks={view.picks} packs={state.packs} />
            <button className="btn small quiet" onClick={leave}>Salir</button>
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

        {playing && (
          <>
            <Scoreboard view={view} connected={connected} {...(seated && { me })} />
            <WaitingLine view={view} />
          </>
        )}

        {seated && playing && (
          <>
            <div className="leave-row">
              <ConfirmButton label="Salir" question="¿Salir de la partida?" onConfirm={leave} />
            </div>
          </>
        )}

        {view.phase.kind === "gameOver" && !revealing && (
          <Podium view={view}>
            <div className="after-game">
              <WaitingLine view={view} connected={connected} />
              {seated && (view.encore.includes(me)
                ? <p className="banner">¡Listo! Le avisamos al anfitrión.</p>
                : <button className="btn big" onClick={() => send({ t: "encore" })}>¡Otra ronda!</button>)}
              {!inLine && <button className="btn small quiet" onClick={leave}>Salir</button>}
            </div>
          </Podium>
        )}

        {view.phase.kind === "closed" && <RoomClosed onLeave={forget} />}
      </main>

      {opening.active && <Roulette view={view} onDone={opening.finish} avatarSize={48} />}
      {revealing && <Reveal view={view} serverNow={serverNow} me={me} onClose={() => setDismissed(reveal!.closedAt)} />}
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
