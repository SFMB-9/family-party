"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  AfterGame, Announcement, Avatar, Board, ConfirmButton, ConnectionDot, CopyText, Podium, QuestionPanel, Reveal, RoomClosed, OptionsPanel,
  Roulette, RulesSummary, Scoreboard, WaitingLine, stageOf, useOpening, useServerNow, revealShowing,
} from "../../components";
import { describeError } from "../../lib/errors";

/** Shown right under the code field instead, so the banner would only repeat it. */
const UNLOCK_ERRORS = new Set(["BAD_CODE", "TOO_MANY_ATTEMPTS"]);
import { useCountdown } from "../../lib/useCountdown";
import { tokenStore } from "../../lib/storage";
import { useRoom } from "../../lib/useRoom";
import { BRAND } from "../../brand";

/** The shared screen: TV in the living room, or a Discord screen share. */
export default function HostPage() {
  const code = String(useParams<{ code: string }>().code).toUpperCase();
  const { status, state, error, send, clockOffset, quality, latencyMs, catalog, unlocked, missingConfig } = useRoom(code, "host");
  const inLobby = state?.view.phase.kind === "lobby";
  // The category picker needs pack names and sizes: ask once the lobby is open.
  useEffect(() => {
    if (status === "open" && inLobby && !catalog) send({ t: "catalog" });
  }, [status, inLobby, catalog, send]);
  const [editingRules, setEditingRules] = useState(false);
  const closeRules = useCallback(() => setEditingRules(false), []);
  const secondsLeft = useCountdown(state?.view.phase, clockOffset, send);
  const reveal = state?.view.reveal;
  const serverNow = useServerNow(clockOffset, !!reveal);
  // Tapping the reveal closes it on this screen only, like on a phone (the host may be playing from here).
  const [dismissed, setDismissed] = useState<number | null>(null);
  const revealing = !!state && revealShowing(state.view, serverNow, dismissed);
  const forget = useCallback(() => {
    tokenStore.clear(code, "host");
    tokenStore.clear(code, "player");
  }, [code]);
  const opening = useOpening(state?.view);

  // ---- "Jugar yo también": when there's no TV, the laptop is the board AND a player.
  // A second connection with a player seat, exactly like a phone; the server can't tell the difference.
  const [wantsSeat, setWantsSeat] = useState(false);
  useEffect(() => {
    if (tokenStore.get(code, "player")) setWantsSeat(true); // reload: take the seat back
  }, [code]);
  const seat = useRoom(code, "player", { enabled: wantsSeat });
  const [seatName, setSeatName] = useState("");
  const [pendingJoin, setPendingJoin] = useState<string | null>(null);
  const me = seat.state?.you.playerId;
  useEffect(() => {
    if (!pendingJoin || seat.status !== "open" || !seat.state || me) return;
    seat.send({ t: "join", name: pendingJoin });
    setPendingJoin(null);
  }, [pendingJoin, seat, me]);
  const takeSeat = (e: FormEvent) => {
    e.preventDefault();
    if (!seatName.trim()) return;
    if (seat.status === "open" && seat.state) seat.send({ t: "join", name: seatName });
    else {
      setPendingJoin(seatName);
      setWantsSeat(true);
    }
  };
  const leaveSeat = () => {
    seat.send({ t: "leave" });
    tokenStore.clear(code, "player");
    setWantsSeat(false);
  };

  if (missingConfig) return <Message text="Falta NEXT_PUBLIC_WS_URL." />;
  if (status === "not-found") return <Message text={`La sala ${code} no existe o ya expiró.`} />;
  if (!state) return <Message text={`Conectando a la sala ${code}…`} />;

  const { view, connected, you } = state;
  const isHost = you.role === "host";
  const playing = view.phase.kind === "picking" || view.phase.kind === "answering";
  const joinUrl = typeof window !== "undefined" ? `${window.location.host}/play/${code}` : "";
  const joinLink = typeof window !== "undefined" ? `${window.location.origin}/play/${code}` : "";
  const myName = me ? view.players.find((p) => p.id === me)?.name : undefined;
  const myTurn = !!me && view.phase.kind === "picking" && view.players[view.turnOwner]?.id === me;
  const myAnswer = !!me && view.phase.kind === "answering" && view.phase.answerer === me;
  const seatControl = me ? (
    <p className="host-seat">
      Juegas desde aquí como <strong>{myName}</strong>
      <button className="link-btn" onClick={leaveSeat}>Dejar de jugar</button>
    </p>
  ) : (
    <form className="host-seat" onSubmit={takeSeat}>
      <label htmlFor="host-seat-name">¿Juegas desde aquí?</label>
      <input
        id="host-seat-name"
        value={seatName}
        onChange={(e) => setSeatName(e.target.value)}
        placeholder="Tu nombre"
        maxLength={20}
        autoComplete="nickname"
      />
      <button className="btn small" type="submit" disabled={!seatName.trim() || pendingJoin !== null}>Unirme</button>
      {seat.error && <span className="seat-error">{describeError(seat.error)}</span>}
    </form>
  );

  return (
    <div className="stage host-screen" data-stage={stageOf(view.phase)}>
      <main className="shell host">
        <header className="top">
          <h1 className="logo">{BRAND}</h1>
          <CopyText className="room-code" text={code} label="el código de la sala" />
          <div className="top-right">
            {isHost && playing && <ConfirmButton label="Terminar" question="¿Terminar ya?" onConfirm={() => send({ t: "end" })} />}
            {isHost && view.phase.kind === "lobby" && <ConfirmButton label="Cerrar sala" question="¿Cerrar la sala?" onConfirm={() => send({ t: "close" })} />}
            <ConnectionDot quality={quality} status={status} latencyMs={latencyMs} />
          </div>
        </header>

        {!isHost && <p className="notice">Estás viendo esta sala. Solo quien la creó puede iniciarla.</p>}
        {error && !UNLOCK_ERRORS.has(error) && <p className="notice error">{describeError(error)}</p>}

        {view.phase.kind === "lobby" && (
          <section className="lobby">
            <div className="lobby-join">
              <p className="pixel-title">Únete desde tu celular</p>
              <CopyText className="join-url" text={joinUrl} copy={joinLink} label="el enlace para unirse" />
              <p className="hint">o abre la página principal y escribe el código</p>
              <CopyText className="room-code huge" text={code} label="el código de la sala" />
            </div>
            <div className="lobby-roster">
              {editingRules && isHost ? (
                <>
                  <OptionsPanel
                    rules={view.rules}
                    picks={view.picks}
                    catalog={catalog}
                    players={view.players.length}
                    error={error}
                    onSave={(next, changed) =>
                      (!changed.rules || send({ t: "rules", rules: next.rules })) &&
                      (!changed.picks || send({ t: "picks", picks: next.picks }))
                    }
                    onClose={closeRules}
                    onUnlock={(attempt) => send({ t: "unlock", code: attempt })}
                    unlocked={unlocked}
                    seat={seatControl}
                  />
                </>
              ) : (
                <>
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
                    <div className="after-actions">
                      {view.players.length > 0 ? (
                        <button className="btn big" onClick={() => send({ t: "start" })}>{me ? "Jugar" : "Transmitir"}</button>
                      ) : (
                        <p className="waiting-players">Esperando jugadores…</p>
                      )}
                    </div>
                  )}
                  <RulesSummary rules={view.rules} picks={view.picks} packs={state.packs} {...(isHost && { onEdit: () => setEditingRules(true) })} />
                </>
              )}
            </div>
          </section>
        )}

        {(view.phase.kind === "picking" || view.phase.kind === "answering") && (
          <div className="game">
            <div className="main-col">
              {myTurn && !opening.active && <p className="banner mine">¡Tu turno, {myName}! Elige una carta</p>}
              {view.phase.kind === "answering" ? (
                <QuestionPanel
                  view={view}
                  secondsLeft={secondsLeft}
                  canAnswer={myAnswer}
                  onAnswer={(choice) => seat.send({ t: "answer", choice })}
                />
              ) : (
                <Board view={view} {...(myTurn && { onPick: (cardId: string) => seat.send({ t: "pick", cardId }) })} />
              )}
            </div>
            <aside>
              <Scoreboard view={view} connected={connected} {...(me && { me })} />
              <WaitingLine view={view} />
            </aside>
          </div>
        )}

        {view.phase.kind === "gameOver" && !revealing && (
          <Podium view={view}>
            {isHost && (
              <AfterGame view={view} connected={connected} onRematch={() => send({ t: "rematch" })} onClose={() => send({ t: "close" })} />
            )}
          </Podium>
        )}

        {view.phase.kind === "closed" && <RoomClosed onLeave={forget} />}
      </main>

      {revealing && <Reveal view={view} serverNow={serverNow} onClose={() => setDismissed(reveal!.closedAt)} {...(me && { me })} />}
      {opening.active && <Roulette view={view} onDone={opening.finish} />}
      <Announcement view={view} holdWhile={revealing || opening.active} skipFirstTurn={opening.ran} />
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
