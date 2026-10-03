"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { rankings, type Card, type Phase, type PlayerId, type PublicState } from "@family-party/game-core";

// ---------------------------------------------------------------- helpers

/** Same id → same hue, so each player keeps a color across screens. */
export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** 200 → "$200", -600 → "-$600". */
export const money = (n: number) => (n < 0 ? `-$${-n}` : `$${n}`);

export const nameOf = (view: PublicState, id: PlayerId | undefined) =>
  view.players.find((p) => p.id === id)?.name ?? "—";

/** Which background color the whole screen uses: one color per phase, as in the 2023 game. */
export function stageOf(phase: Phase | undefined): "lobby" | "board" | "question" | "podium" {
  switch (phase?.kind) {
    case "picking":
      return "board";
    case "answering":
      return "question";
    case "gameOver":
      return "podium";
    default:
      return "lobby";
  }
}

/** Server-clock "now", ticking only while `active`. */
export function useServerNow(clockOffset: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now() + clockOffset);
    const id = setInterval(() => setNow(Date.now() + clockOffset), 250);
    return () => clearInterval(id);
  }, [active, clockOffset]);
  return now;
}

// ---------------------------------------------------------------- avatar

/**
 * Generic pixel avatar: the player's initial on their color, in a framed square
 * like the 2023 portraits. The private Familia theme will swap in real portraits.
 */
export function Avatar({ id, name, size = 48 }: { id: string; name: string; size?: number }) {
  return (
    <span className="avatar" style={{ ["--hue" as string]: hueFor(id), width: size, height: size, fontSize: Math.round(size / 2 / 12) * 12 || 12 }} aria-hidden>
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

// ---------------------------------------------------------------- score pops

/** Compares scores between snapshots and returns the latest change per player (the old Adder/Substracter animation). */
function useScorePops(scores: Record<PlayerId, number>) {
  const previous = useRef(scores);
  const [pops, setPops] = useState<Record<PlayerId, { delta: number; key: number }>>({});

  useEffect(() => {
    const changed: Record<PlayerId, { delta: number; key: number }> = {};
    for (const [id, score] of Object.entries(scores)) {
      const before = previous.current[id];
      if (before !== undefined && before !== score) changed[id] = { delta: score - before, key: Date.now() };
    }
    previous.current = scores;
    if (Object.keys(changed).length === 0) return;
    setPops((p) => ({ ...p, ...changed }));
    const t = setTimeout(() => setPops((p) => {
      const next = { ...p };
      for (const id of Object.keys(changed)) if (next[id]?.key === changed[id]!.key) delete next[id];
      return next;
    }), 1_800);
    return () => clearTimeout(t);
  }, [scores]);

  return pops;
}

// ---------------------------------------------------------------- players & scores

export function Scoreboard({ view, connected, me }: { view: PublicState; connected: PlayerId[]; me?: PlayerId }) {
  const owner = view.players[view.turnOwner]?.id;
  const pops = useScorePops(view.scores);
  return (
    <ol className="scores">
      {rankings(view).map(({ player, score, rank }) => (
        <li
          key={player.id}
          className={[player.id === me && "me", player.id === owner && view.phase.kind !== "lobby" && "turn", !connected.includes(player.id) && "away"]
            .filter(Boolean).join(" ")}
        >
          <span className="rank">{rank}</span>
          <Avatar id={player.id} name={player.name} size={36} />
          <span className="name">{player.name}</span>
          <span className="score">
            {money(score)}
            {pops[player.id] && (
              <span key={pops[player.id]!.key} className={`pop ${pops[player.id]!.delta > 0 ? "up" : "down"}`}>
                {pops[player.id]!.delta > 0 ? "+" : ""}{money(pops[player.id]!.delta)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- board

/** Cards grouped into category columns, in the order they were dealt. */
function columns(board: Card[]): [string, Card[]][] {
  const map = new Map<string, Card[]>();
  for (const card of board) map.set(card.category, [...(map.get(card.category) ?? []), card]);
  return [...map];
}

export function Board({ view, onPick }: { view: PublicState; onPick?: (cardId: string) => void }) {
  const openCard = view.phase.kind === "answering" ? view.phase.cardId : null;
  const cols = columns(view.board);
  return (
    <div className="board" style={{ ["--cols" as string]: cols.length }}>
      {cols.map(([category, cards]) => (
        <div key={category} className="column">
          <div className="category">{category}</div>
          {cards.map((card) => (
            <button
              key={card.id}
              className={`card ${card.played ? "played" : ""} ${card.id === openCard ? "open" : ""}`}
              disabled={!onPick || card.played || openCard !== null}
              onClick={() => onPick?.(card.id)}
              aria-label={card.played ? `${category}: jugada` : `${category}: ${money(card.value)}`}
            >
              {card.played ? "" : money(card.value)}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- question

export function QuestionPanel({
  view,
  secondsLeft,
  canAnswer,
  onAnswer,
}: {
  view: PublicState;
  secondsLeft: number | null;
  canAnswer: boolean;
  onAnswer?: (choice: number) => void;
}) {
  if (view.phase.kind !== "answering" || !view.current) return null;
  const { phase, current } = view;
  const stealing = phase.tried.length > 0;

  return (
    <section className="question">
      <header>
        <span className="tag">{current.category}</span>
        <span className="stake">{money(phase.stake)}</span>
        {secondsLeft !== null && <span className={`timer ${secondsLeft <= 5 ? "hurry" : ""}`}>{secondsLeft}</span>}
      </header>
      {current.prompt.media?.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="media" src={current.prompt.media.url} alt="" />
      )}
      <h2>{current.prompt.text}</h2>
      <p className={`who ${stealing ? "steal" : ""}`}>
        {stealing ? "Robo: " : "Responde: "}
        <strong>{nameOf(view, phase.answerer)}</strong>
      </p>
      <div className="options">
        {current.response.options.map((option, i) => (
          <button key={option} className="option" disabled={!canAnswer} onClick={() => onAnswer?.(i)}>
            <span className="letter">{"ABCDEF"[i]}</span>
            <span>{option}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- reveal

export const REVEAL_MS = 5_000;

/** After a card closes: the right answer, who picked what, and the points. Non-blocking: play continues underneath. */
export function Reveal({ view, serverNow, onClose }: { view: PublicState; serverNow: number; onClose?: () => void }) {
  const reveal = view.reveal;
  if (!reveal || serverNow - reveal.closedAt > REVEAL_MS) return null;

  const pickedBy = (i: number) => reveal.results.filter((r) => r.choice === i);
  const timedOut = reveal.results.filter((r) => r.choice === null);
  const winner = reveal.results.find((r) => r.delta > 0);

  return (
    <div className="overlay" onClick={onClose} role="status">
      <section className="reveal">
        <header>
          <span className="tag">{reveal.category}</span>
          <span className="headline">{winner ? `¡${nameOf(view, winner.playerId)} acertó!` : "Nadie acertó"}</span>
        </header>
        <h2>{reveal.text}</h2>
        <ul className="reveal-options">
          {reveal.options.map((option, i) => {
            const right = reveal.correct.includes(i);
            const pickers = pickedBy(i);
            return (
              <li key={option} className={right ? "right" : pickers.length ? "wrong" : ""}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {(right || pickers.length > 0) && <img className="mark" src={right ? "/sprites/right.png" : "/sprites/wrong.png"} alt={right ? "Correcta" : "Incorrecta"} />}
                <span className="text">{option}</span>
                <span className="pickers">
                  {pickers.map((r) => <Avatar key={r.playerId} id={r.playerId} name={nameOf(view, r.playerId)} size={24} />)}
                </span>
              </li>
            );
          })}
        </ul>
        <ul className="deltas">
          {reveal.results.map((r) => (
            <li key={r.playerId} className={r.delta > 0 ? "up" : r.delta < 0 ? "down" : ""}>
              {nameOf(view, r.playerId)} {r.choice === null ? "(sin tiempo)" : ""} <strong>{r.delta > 0 ? "+" : ""}{money(r.delta)}</strong>
            </li>
          ))}
          {timedOut.length === 0 && reveal.results.length === 0 && <li>Sin respuestas</li>}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- announcements

/**
 * The big between-turn moments from the 2023 game ("TURNO DE ANDREA", "SALVA, PUEDES
 * ROBAR ESTA PREGUNTA"), minus the confirm button: they play for 2s and get out of the way.
 */
export function Announcement({ view, holdWhile }: { view: PublicState; holdWhile: boolean }) {
  const phase = view.phase;
  const owner = view.players[view.turnOwner];
  let key: string | null = null;
  let content: { title: string; subtitle?: string; playerId: string; name: string } | null = null;

  if (phase.kind === "picking" && owner) {
    key = `turn-${view.board.filter((c) => c.played).length}`;
    content = { title: `Turno de ${owner.name}`, subtitle: money(view.scores[owner.id] ?? 0), playerId: owner.id, name: owner.name };
  } else if (phase.kind === "answering" && phase.tried.length > 0) {
    key = `steal-${phase.cardId}-${phase.tried.length}`;
    const name = nameOf(view, phase.answerer);
    content = { title: `${name}, puedes robar esta pregunta`, subtitle: money(phase.stake), playerId: phase.answerer, name };
  }

  const [shownKey, setShownKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  // Show once per new key (after any reveal finishes)...
  useEffect(() => {
    if (!key || key === shownKey || holdWhile) return;
    setShownKey(key);
    setVisible(true);
  }, [key, shownKey, holdWhile]);

  // ...and hide 2.2 s later. Separate effect so setting shownKey doesn't cancel the timer.
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setVisible(false), 2_200);
    return () => clearTimeout(t);
  }, [visible, shownKey]);

  if (!visible || !content) return null;
  return (
    <div className="overlay announce" role="status">
      <div className="announce-card">
        <Avatar id={content.playerId} name={content.name} size={144} />
        <div>
          <p className="announce-title">{content.title}</p>
          {content.subtitle && <p className="announce-sub">{content.subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- end of game

const PLACES = ["Primer lugar", "Segundo lugar", "Tercer lugar"];

export function Podium({ view, children }: { view: PublicState; children?: ReactNode }) {
  const ranked = rankings(view);
  const top = ranked.filter((r) => r.rank <= 3);
  const rest = ranked.filter((r) => r.rank > 3);
  return (
    <section className="podium">
      <h2 className="pixel-title">Fin del juego</h2>
      <div className="podium-body">
        <ol className="winners">
          {top.map(({ player, score, rank }, i) => (
            <li key={player.id} style={{ animationDelay: `${(top.length - 1 - i) * 400}ms` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="trophy" src={`/sprites/trophy-${rank}.png`} alt={PLACES[rank - 1]} />
              <Avatar id={player.id} name={player.name} size={72} />
              <div>
                <p className="place">{PLACES[rank - 1]}</p>
                <p className="name">{player.name}</p>
                <p className="score">{money(score)}</p>
              </div>
            </li>
          ))}
        </ol>
        {rest.length > 0 && (
          <ol className="rest">
            {rest.map(({ player, score, rank }) => (
              <li key={player.id}>
                <span className="rank">{rank}</span>
                <Avatar id={player.id} name={player.name} size={32} />
                <span className="name">{player.name}</span>
                <span className="score">{money(score)}</span>
              </li>
            ))}
          </ol>
        )}
        {children}
      </div>
    </section>
  );
}

/** Host podium: who asked for another round, as avatars. */
export function EncoreList({ view, connected }: { view: PublicState; connected: PlayerId[] }) {
  const here = view.players.filter((p) => connected.includes(p.id));
  const wanting = view.players.filter((p) => view.encore.includes(p.id));
  if (wanting.length === 0) return <p className="hint">Los jugadores pueden pedir otra ronda desde su celular.</p>;
  return (
    <p className="encore">
      <span className="pixel-title small">Quieren otra</span>
      {wanting.map((p) => <Avatar key={p.id} id={p.id} name={p.name} size={36} />)}
      <span className="count">{wanting.length}/{here.length}</span>
    </p>
  );
}

// ---------------------------------------------------------------- shared controls

/**
 * Two taps, no dialog: the button turns into "question Sí / No" for a few seconds.
 * Only for things that can't be undone (ending a game, closing the room).
 */
export function ConfirmButton({ label, question, onConfirm }: { label: string; question: string; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 4_000);
    return () => clearTimeout(t);
  }, [asking]);

  if (!asking) {
    return <button className="btn small quiet" onClick={() => setAsking(true)}>{label}</button>;
  }
  return (
    <span className="end-confirm" role="group" aria-label={question}>
      <span className="pixel-title small">{question}</span>
      <button className="btn small danger" onClick={onConfirm}>Sí</button>
      <button className="btn small" onClick={() => setAsking(false)}>No</button>
    </span>
  );
}

/** The host closed the room: say so, forget this room's seat, and go home. */
export function RoomClosed({ onLeave }: { onLeave: () => void }) {
  const router = useRouter();
  useEffect(() => {
    onLeave();
    const t = setTimeout(() => router.replace("/"), 2_500);
    return () => clearTimeout(t);
  }, [onLeave, router]);
  return (
    <section className="waiting">
      <p className="pixel-title">Sala cerrada</p>
      <p className="hint">Gracias por jugar. Volviendo al inicio…</p>
    </section>
  );
}
