"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Announcement, Avatar, Board, ConfirmButton, ConnectionDot, CopyText, EncoreList, Podium, QuestionPanel, REVEAL_MS, Reveal, RoomClosed, OptionsPanel,
  Roulette, RulesSummary, Scoreboard, stageOf, useOpening, useServerNow,
} from "../../components";
import { describeError } from "../../lib/errors";

/** Shown right under the code field instead, so the banner would only repeat it. */
const UNLOCK_ERRORS = new Set(["BAD_CODE", "TOO_MANY_ATTEMPTS"]);
import { useCountdown } from "../../lib/useCountdown";
import { tokenStore } from "../../lib/storage";
import { useRoom } from "../../lib/useRoom";

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
  const revealing = !!reveal && serverNow - reveal.closedAt <= REVEAL_MS;
  const forget = useCallback(() => tokenStore.clear(code, "host"), [code]);
  const opening = useOpening(state?.view);

  if (missingConfig) return <Message text="Falta NEXT_PUBLIC_WS_URL." />;
  if (status === "not-found") return <Message text={`La sala ${code} no existe o ya expiró.`} />;
  if (!state) return <Message text={`Conectando a la sala ${code}…`} />;

  const { view, connected, you } = state;
  const isHost = you.role === "host";
  const playing = view.phase.kind === "picking" || view.phase.kind === "answering";
  const joinUrl = typeof window !== "undefined" ? `${window.location.host}/play/${code}` : "";
  const joinLink = typeof window !== "undefined" ? `${window.location.origin}/play/${code}` : "";

  return (
    <div className="stage host-screen" data-stage={stageOf(view.phase)}>
      <main className="shell host">
        <header className="top">
          <h1 className="logo">Family Party</h1>
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
                        <button className="btn big" onClick={() => send({ t: "start" })}>Jugar</button>
                      ) : (
                        <p className="waiting-players">Esperando jugadores…</p>
                      )}
                    </div>
                  )}
                  <RulesSummary rules={view.rules} picks={view.picks} {...(isHost && { onEdit: () => setEditingRules(true) })} />
                </>
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

        {view.phase.kind === "gameOver" && !revealing && (
          <Podium view={view}>
            {isHost && (
              <div className="after-game">
                <EncoreList view={view} connected={connected} />
                <div className="after-actions">
                  <button className="btn big" onClick={() => send({ t: "rematch" })}>Otra ronda</button>
                  <ConfirmButton label="Cerrar sala" question="¿Cerrar la sala?" onConfirm={() => send({ t: "close" })} />
                </div>
                <p className="hint">Misma sala, preguntas nuevas. Quien ya salió no entra; pueden unirse más.</p>
              </div>
            )}
          </Podium>
        )}

        {view.phase.kind === "closed" && <RoomClosed onLeave={forget} />}
      </main>

      <Reveal view={view} serverNow={serverNow} />
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
