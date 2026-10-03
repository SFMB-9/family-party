"use client";

import { rankings, type Card, type PlayerId, type PublicState } from "@family-party/game-core";

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

// ---------------------------------------------------------------- players & scores

export function Scoreboard({ view, connected, me }: { view: PublicState; connected: PlayerId[]; me?: PlayerId }) {
  const owner = view.players[view.turnOwner]?.id;
  return (
    <ol className="scores">
      {rankings(view).map(({ player, score, rank }) => (
        <li
          key={player.id}
          className={[player.id === me && "me", player.id === owner && view.phase.kind !== "lobby" && "turn"].filter(Boolean).join(" ")}
          style={{ ["--hue" as string]: hueFor(player.id) }}
        >
          <span className="rank">{rank}</span>
          <span className={`dot ${connected.includes(player.id) ? "on" : "off"}`} title={connected.includes(player.id) ? "Conectado" : "Desconectado"} />
          <span className="name">{player.name}</span>
          <span className="score">{money(score)}</span>
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
  return (
    <div className="board" style={{ ["--cols" as string]: columns(view.board).length }}>
      {columns(view.board).map(([category, cards]) => (
        <div key={category} className="column">
          <div className="category">{category}</div>
          {cards.map((card, i) => (
            <button
              key={card.id}
              className={`card ${card.played ? "played" : ""} ${card.id === openCard ? "open" : ""}`}
              disabled={!onPick || card.played || openCard !== null}
              onClick={() => onPick?.(card.id)}
            >
              {card.played ? "✓" : i + 1}
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
        {secondsLeft !== null && <span className={`timer ${secondsLeft <= 5 ? "hurry" : ""}`}>{secondsLeft}s</span>}
      </header>
      {current.prompt.media?.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="media" src={current.prompt.media.url} alt="" />
      )}
      <h2>{current.prompt.text}</h2>
      <p className="who">
        {stealing ? "🔥 Robo: " : "Responde: "}
        <strong>{nameOf(view, phase.answerer)}</strong>
      </p>
      <div className="options">
        {current.response.options.map((option, i) => (
          <button key={option} className="option" disabled={!canAnswer} onClick={() => onAnswer?.(i)}>
            <span className="letter">{"ABCDEF"[i]}</span>
            {option}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- end of game

export function Podium({ view }: { view: PublicState }) {
  const ranked = rankings(view);
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <section className="podium">
      <h2>¡Fin del juego!</h2>
      <ol>
        {ranked.map(({ player, score, rank }) => (
          <li key={player.id} style={{ ["--hue" as string]: hueFor(player.id) }}>
            <span className="medal">{medals[rank - 1] ?? `${rank}.`}</span>
            <span className="name">{player.name}</span>
            <span className="score">{money(score)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
