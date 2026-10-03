"use client";

import { useRouter } from "next/navigation";
import { describeError as describeErrorText } from "./lib/errors";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PackInfo } from "@family-party/protocol";
import { DEFAULT_RULES, rankings, rowsFor, type Card, type Phase, type Pick, type PlayerId, type PublicState, type Rules } from "@family-party/game-core";

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
/** Cards grouped by board column, in deal order. Header = the column's category, or none on a mixed board. */
function columns(board: Card[], mixed: boolean): [number, string | null, Card[]][] {
  const map = new Map<number, Card[]>();
  for (const card of board) map.set(card.column, [...(map.get(card.column) ?? []), card]);
  return [...map].sort(([a], [b]) => a - b).map(([column, cards]) => [column, mixed ? null : cards[0]!.category, cards]);
}

export function Board({ view, onPick }: { view: PublicState; onPick?: (cardId: string) => void }) {
  const openCard = view.phase.kind === "answering" ? view.phase.cardId : null;
  const cols = columns(view.board, view.rules.mixed);
  return (
    <div className={`board ${view.rules.mixed ? "mixed" : ""}`} style={{ ["--cols" as string]: cols.length }}>
      {cols.map(([column, category, cards]) => (
        <div key={column} className="column">
          {category !== null && <div className="category">{category}</div>}
          {cards.map((card) => (
            <button
              key={card.id}
              className={`card ${card.played ? "played" : ""} ${card.id === openCard ? "open" : ""}`}
              disabled={!onPick || card.played || openCard !== null}
              onClick={() => onPick?.(card.id)}
              aria-label={`${category ?? "Carta"}: ${card.played ? "jugada" : money(card.value)}`}
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
export function Reveal({ view, serverNow, onClose, me }: {
  view: PublicState; serverNow: number; onClose?: () => void;
  /** On a phone: the player looking at it, so their own win reads "¡Acertaste!". */
  me?: PlayerId | null;
}) {
  const reveal = view.reveal;
  if (!reveal || serverNow - reveal.closedAt > REVEAL_MS) return null;

  const pickedBy = (i: number) => reveal.results.filter((r) => r.choice === i);
  const timedOut = reveal.results.filter((r) => r.choice === null);
  const winner = reveal.results.find((r) => r.delta > 0);
  // On a phone: did this player try and miss (wrong answer or ran out of time)?
  const iMissed = !!me && reveal.results.some((r) => r.playerId === me && r.delta <= 0);
  const iWon = !!me && winner?.playerId === me; // TV has no `me`: undefined === undefined must not count
  const headline = iWon
    ? { text: "¡Acertaste!", tone: "mine" }
    : iMissed
      ? { text: winner ? `¡Lástima! ${nameOf(view, winner.playerId)} acertó` : "¡Lástima!", tone: "missed" }
      : { text: winner ? `¡${nameOf(view, winner.playerId)} acertó!` : "Nadie acertó", tone: "" };

  return (
    <div className="overlay" onClick={onClose} role="status">
      <section className="reveal">
        <header>
          <span className="tag">{reveal.category}</span>
          <span className={`headline ${headline.tone}`}>{headline.text}</span>
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

// ---------------------------------------------------------------- house rules

type Option<T> = { value: T; label: string };

const RULE_OPTIONS = {
  wrongAnswer: [
    { value: "lose", label: "Resta" },
    { value: "floor", label: "Resta, sin bajar de $0" },
    { value: "keep", label: "Sin castigo" },
  ],
  timer: [
    { value: "question", label: "Por pregunta" },
    { value: 15, label: "15 s" },
    { value: 20, label: "20 s" },
    { value: 30, label: "30 s" },
    { value: "off", label: "Sin límite" },
  ],
  steals: [
    { value: "half", label: "A mitad" },
    { value: "full", label: "Completos" },
    { value: "off", label: "No" },
  ],
  stealTime: [
    { value: "fresh", label: "Tiempo nuevo" },
    { value: "remaining", label: "Lo que quedaba" },
    { value: "half", label: "Mitad" },
  ],
  mixed: [
    { value: false, label: "Por categorías" },
    { value: true, label: "Mezclado" },
  ],
  columns: [3, 4, 5].map((n) => ({ value: n, label: String(n) })),
  rows: [
    { value: "players", label: "1 por jugador" },
    ...[2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) })),
  ],
} satisfies { [K in keyof Rules]: Option<Rules[K]>[] };

const labelOf = <K extends keyof Rules>(key: K, value: Rules[K]) =>
  (RULE_OPTIONS[key] as Option<Rules[K]>[]).find((o) => o.value === value)?.label ?? String(value);

const RULE_KEYS = Object.keys(DEFAULT_RULES) as (keyof Rules)[];
const sameRules = (a: Rules, b: Rules) => RULE_KEYS.every((k) => a[k] === b[k]);

/** 12×12 pixel booklet, drawn on a grid like the fonts: crisp at 2× (24px) and 3×. */
function BookletIcon() {
  // "#" = ink, "-" = page, "." = empty
  const art = [
    "............",
    ".####.####..",
    "#----#----#.",
    "#-##-#-##-#.",
    "#----#----#.",
    "#-##-#-##-#.",
    "#----#----#.",
    "#-##-#-##-#.",
    "#----#----#.",
    ".####.####..",
    "......#.....",
    "............",
  ];
  const cells = art.flatMap((row, y) => [...row].map((c, x) => ({ c, x, y }))).filter((p) => p.c !== ".");
  return (
    <svg className="booklet" viewBox="0 0 12 12" width="24" height="24" shapeRendering="crispEdges" aria-hidden>
      {cells.map(({ c, x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c === "#" ? "currentColor" : "var(--page, #f2f2f2)"} />
      ))}
    </svg>
  );
}

/**
 * "Reglas de esta partida" as a booklet: closed by default so the lobby stays simple,
 * but it says when the host changed something, and changed rules are gold inside.
 */
export function RulesSummary({ rules, picks = [] }: { rules: Rules; picks?: Pick[] }) {
  const [open, setOpen] = useState(false);
  const changed = RULE_KEYS.filter((k) => rules[k] !== DEFAULT_RULES[k]);
  const isChanged = (...keys: (keyof Rules)[]) => keys.some((k) => changed.includes(k));

  const rows: [string, string, boolean][] = [
    ["Respuesta incorrecta", labelOf("wrongAnswer", rules.wrongAnswer), isChanged("wrongAnswer")],
    ["Tiempo", labelOf("timer", rules.timer), isChanged("timer")],
    [
      "Robos",
      rules.steals === "off"
        ? "No"
        : `${labelOf("steals", rules.steals)}${rules.timer === "off" ? "" : ` · ${labelOf("stealTime", rules.stealTime).toLowerCase()}`}`,
      isChanged("steals", "stealTime"),
    ],
    [
      "Tablero",
      `${rules.mixed ? "Mezclado" : "Por categorías"}, ${rules.columns} × ${rules.rows === "players" ? "1 por jugador" : rules.rows}`,
      isChanged("mixed", "columns", "rows"),
    ],
  ];
  if (picks.length > 0) {
    const names = picks.map((p) => p.category);
    const shown = names.slice(0, 5).join(", ");
    rows.push(["Preguntas", names.length > 5 ? `${shown} y ${names.length - 5} más` : shown, false]);
  }

  return (
    <aside className="rules-corner">
      {open && (
        <dl className="rules-popover" id="rules-popover">
          {rows.map(([term, value, differs]) => (
            <div key={term} className={differs ? "changed" : ""}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <button className="booklet-toggle" aria-expanded={open} aria-controls="rules-popover" onClick={() => setOpen((o) => !o)}>
        <BookletIcon />
        <span className="label">{changed.length === 0 ? "Reglas clásicas" : "Reglas de la casa"}</span>
        {changed.length > 0 && <span className="changes">{changed.length}</span>}
      </button>
    </aside>
  );
}

/** Segmented choice: the selected option is the light button, the rest stay quiet. */
function Choice<K extends keyof Rules>({ label, field, rules, onChange }: {
  label: string; field: K; rules: Rules; onChange: (patch: Partial<Rules>) => void;
}) {
  return (
    <div className="choice" role="group" aria-label={label}>
      <span className="choice-label">{label}</span>
      <div className="choice-options">
        {(RULE_OPTIONS[field] as Option<Rules[K]>[]).map((o) => (
          <button
            key={String(o.value)}
            className={`btn small ${o.value === rules[field] ? "" : "quiet"}`}
            aria-pressed={o.value === rules[field]}
            onClick={() => onChange({ [field]: o.value } as Partial<Rules>)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type Options = { rules: Rules; picks: Pick[] };

const pickKey = (p: Pick) => `${p.pack}\u0000${p.category}`;
const samePicks = (a: Pick[], b: Pick[]) => a.length === b.length && a.every((p) => b.some((q) => pickKey(q) === pickKey(p)));
const allPicksOf = (catalog: PackInfo[]): Pick[] => catalog.flatMap((p) => p.categories.map((c) => ({ pack: p.id, category: c.name })));

/** Cards each category column needs with these rules and this many players (at least 1, so an empty lobby isn't misleading). */
const neededPerCategory = (rules: Rules, players: number) => rowsFor(rules, Math.max(players, 1));

/**
 * Host lobby: house rules and categories as one draft, in two tabs. Nothing reaches the
 * server (or the phones) until Guardar; the panel closes only once the saved values come
 * back in a snapshot, so a rejected save never looks like it worked.
 */
export function OptionsPanel({ rules, picks, catalog, players, error, onSave, onClose }: {
  rules: Rules;
  picks: Pick[];
  catalog: PackInfo[] | null;
  players: number;
  error: string | null;
  onSave: (next: Options, changed: { rules: boolean; picks: boolean }) => boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"rules" | "questions">("questions"); // what to play first, then how
  const [draft, setDraft] = useState<Options>({ rules, picks });
  const [saving, setSaving] = useState<"idle" | "waiting" | "failed">("idle");
  const editRules = (patch: Partial<Rules>) => {
    setSaving("idle");
    setDraft((d) => ({ ...d, rules: { ...d.rules, ...patch } }));
  };
  const editPicks = (next: Pick[]) => {
    setSaving("idle");
    setDraft((d) => ({ ...d, picks: next }));
  };
  const changed = { rules: !sameRules(draft.rules, rules), picks: !samePicks(draft.picks, picks) };
  const dirty = changed.rules || changed.picks;

  // Saved: the server's values now match the draft.
  useEffect(() => {
    if (saving === "waiting" && sameRules(rules, draft.rules) && samePicks(picks, draft.picks)) onClose();
  }, [saving, rules, picks, draft, onClose]);
  // Rejected, or no answer at all.
  useEffect(() => {
    if (saving !== "waiting") return;
    if (error) return setSaving("failed");
    const t = setTimeout(() => setSaving("failed"), 5_000);
    return () => clearTimeout(t);
  }, [saving, error]);

  const needed = neededPerCategory(draft.rules, players);
  const countOf = (p: Pick) => catalog?.find((pk) => pk.id === p.pack)?.categories.find((c) => c.name === p.category)?.count ?? 0;
  const playable = draft.picks.filter((p) => draft.rules.mixed || countOf(p) >= needed);
  const canSave = !catalog || playable.length > 0;

  const save = () => setSaving(onSave(draft, changed) ? "waiting" : "failed");
  const defaults = tab === "rules" ? sameRules(draft.rules, DEFAULT_RULES) : !catalog || samePicks(draft.picks, allPicksOf(catalog));
  const reset = () => (tab === "rules" ? editRules(DEFAULT_RULES) : catalog && editPicks(allPicksOf(catalog)));

  return (
    <div className="rules-panel">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "questions"} className={`tab ${tab === "questions" ? "on" : ""}`} onClick={() => setTab("questions")}>
          Preguntas{changed.picks && <span className="tab-dot" aria-label="sin guardar" />}
        </button>
        <button role="tab" aria-selected={tab === "rules"} className={`tab ${tab === "rules" ? "on" : ""}`} onClick={() => setTab("rules")}>
          Reglas{changed.rules && <span className="tab-dot" aria-label="sin guardar" />}
        </button>
      </div>

      {tab === "rules" ? (
        <RulesFields rules={draft.rules} players={players} onChange={editRules} />
      ) : (
        <PicksFields catalog={catalog} picks={draft.picks} rules={draft.rules} players={players} onChange={editPicks} />
      )}

      {saving === "failed" && (
        <p className="hint warn" role="alert">No se guardó: {describeErrorText(error) ?? "el servidor no respondió"}. Intenta de nuevo.</p>
      )}
      <div className="panel-footer">
        <button className="link-btn" disabled={defaults} onClick={reset}>Restablecer</button>
        <div className="panel-footer-actions">
          {dirty ? (
            <>
              <button className="btn small quiet" onClick={() => { setSaving("idle"); setDraft({ rules, picks }); }}>Cancelar</button>
              <button className="btn small" disabled={saving === "waiting" || !canSave} onClick={save}>
                {saving === "waiting" ? "Guardando…" : "Guardar"}
              </button>
            </>
          ) : (
            <button className="btn small" onClick={onClose}>Volver</button>
          )}
        </div>
      </div>
    </div>
  );
}

function RulesFields({ rules, players, onChange }: { rules: Rules; players: number; onChange: (patch: Partial<Rules>) => void }) {
  const rows = rowsFor(rules, players);
  const cards = rules.columns * rows;
  const uneven = players > 1 && cards % players !== 0;
  return (
    <>
      <Choice label="Respuesta incorrecta" field="wrongAnswer" rules={rules} onChange={onChange} />
      <Choice label="Tiempo" field="timer" rules={rules} onChange={onChange} />
      <Choice label="Robos" field="steals" rules={rules} onChange={onChange} />
      {rules.steals !== "off" && rules.timer !== "off" && (
        <Choice label="Tiempo para robar" field="stealTime" rules={rules} onChange={onChange} />
      )}
      <Choice label="Tablero" field="mixed" rules={rules} onChange={onChange} />
      <Choice label={rules.mixed ? "Columnas" : "Categorías"} field="columns" rules={rules} onChange={onChange} />
      <Choice label={rules.mixed ? "Cartas por columna" : "Cartas por categoría"} field="rows" rules={rules} onChange={onChange} />
      <p className={`hint ${uneven ? "warn" : ""}`}>
        {players === 0
          ? `${rules.columns} columnas × ${rules.rows === "players" ? "1 carta por jugador" : `${rules.rows} cartas`}`
          : uneven
            ? `${cards} cartas para ${players} jugadores: no todos tendrán los mismos turnos.`
            : `${cards} cartas: ${cards / Math.max(players, 1)} turno${cards / Math.max(players, 1) === 1 ? "" : "s"} por jugador.`}
      </p>
    </>
  );
}

/**
 * Packs and their categories as chips. A category that can't fill a column with the
 * current players and rules is dashed and explains why; it comes back on its own when
 * players leave or rows shrink. On a mixed board every category counts (one shared pool).
 */
function PicksFields({ catalog, picks, rules, players, onChange }: {
  catalog: PackInfo[] | null; picks: Pick[]; rules: Rules; players: number; onChange: (picks: Pick[]) => void;
}) {
  if (!catalog) return <p className="hint">Cargando categorías…</p>;
  const needed = neededPerCategory(rules, players);
  const picked = new Set(picks.map(pickKey));
  const fits = (count: number) => rules.mixed || count >= needed;

  const all = catalog.flatMap((p) => p.categories.map((c) => ({ pick: { pack: p.id, category: c.name }, count: c.count })));
  const chosen = all.filter((c) => picked.has(pickKey(c.pick)));
  const playable = chosen.filter((c) => fits(c.count));
  const short = chosen.length - playable.length;
  const pool = playable.reduce((n, c) => n + c.count, 0);

  const toggle = (p: Pick) => onChange(picked.has(pickKey(p)) ? picks.filter((x) => pickKey(x) !== pickKey(p)) : [...picks, p]);
  const setPack = (packId: string, on: boolean) => {
    const others = picks.filter((p) => p.pack !== packId);
    const pack = catalog.find((p) => p.id === packId)!;
    onChange(on ? [...others, ...pack.categories.map((c) => ({ pack: packId, category: c.name }))] : others);
  };

  let summary: ReactNode;
  if (playable.length === 0) summary = <span className="warn-text">Elige al menos una categoría con suficientes preguntas</span>;
  else if (rules.mixed) {
    summary = pool >= rules.columns * needed
      ? <>Tablero mezclado: <b>{rules.columns * needed}</b> cartas de <b>{playable.length}</b> categorías</>
      : <span className="warn-text">Solo hay {pool} preguntas para {rules.columns * needed} cartas: el tablero saldrá más chico</span>;
  } else if (playable.length > rules.columns) summary = <>Elegidas <b>{playable.length}</b> categorías · se juegan <b>{rules.columns}</b> al azar</>;
  else summary = <>Se juegan las <b>{playable.length}</b>{playable.length < rules.columns && " (el tablero tendrá menos columnas)"}</>;

  return (
    <>
      <p className="pick-summary">
        {summary}
        {short > 0 && playable.length > 0 && <span className="muted"> · {short} sin suficientes preguntas</span>}
      </p>
      <div className="packs">
        {catalog.map((pack) => {
          const usable = pack.categories.filter((c) => fits(c.count));
          const allOn = usable.length > 0 && usable.every((c) => picked.has(pickKey({ pack: pack.id, category: c.name })));
          return (
            <div key={pack.id} className="pack">
              <div className="pack-head">
                <span className="pack-name">{pack.name}</span>
                <button className="link-btn" onClick={() => setPack(pack.id, !allOn)}>{allOn ? "Quitar todas" : "Elegir todas"}</button>
              </div>
              <div className="chips">
                {pack.categories.map((c) => {
                  const p = { pack: pack.id, category: c.name };
                  const ok = fits(c.count);
                  const on = picked.has(pickKey(p));
                  return (
                    <button
                      key={c.name}
                      className={`chip ${on && ok ? "on" : ""} ${ok ? "" : "off-limit"}`}
                      aria-pressed={on && ok}
                      disabled={!ok}
                      title={ok ? undefined : `Con estas reglas cada categoría necesita ${needed} preguntas`}
                      onClick={() => toggle(p)}
                    >
                      {c.name} <small>{ok ? c.count : `${c.count} · necesita ${needed}`}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {!rules.mixed && (
        <p className="hint">
          {rules.rows === "players"
            ? `${Math.max(players, 1)} jugador${players === 1 || players === 0 ? "" : "es"} · 1 carta por jugador: cada categoría necesita al menos ${needed} pregunta${needed === 1 ? "" : "s"}.`
            : `${needed} cartas por categoría: cada categoría necesita al menos ${needed} preguntas.`}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------- copy to clipboard

/** Clipboard API needs a secure context (https or localhost); a LAN/Tailscale IP over http doesn't have one. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the old way */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 12×12 pixel chain link (two links, diagonal): "this is a link you can share". */
function ChainIcon() {
  const art = [
    "............",
    ".......####.",
    "......#....#",
    "......#....#",
    "....#.#...#.",
    "...#.#.#.#..",
    "..#.#.#.#...",
    ".#...#.#....",
    "#....#......",
    "#....#......",
    ".####.......",
    "............",
  ];
  return (
    <svg className="chain" viewBox="0 0 12 12" width="12" height="12" shapeRendering="crispEdges" aria-hidden>
      {art.flatMap((row, y) =>
        [...row].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)),
      )}
    </svg>
  );
}

/**
 * Text that copies itself when clicked (the room code, the join link), with a short
 * "¡Copiado!" so the tap visibly did something. Looks exactly like the text it replaces.
 * With `share`, phones that support it open their share menu (WhatsApp, Messages…) instead.
 */
export function CopyText({ text, copy = text, className = "", label, share, icon }: {
  text: string; copy?: string; className?: string; label: string;
  share?: { title: string; text: string; url: string };
  /** Show a chain-link icon so it's obvious this is tappable (phones). */
  icon?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const isLink = /^https?:\/\//.test(copy);
  const onClick = async () => {
    if (share && typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share(share);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // they closed the menu
        // anything else: fall back to copying
      }
    }
    setState((await copyText(copy)) ? "copied" : "failed");
  };
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1_500);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={`copy-text ${className}`}
      title={`Copiar ${label}`}
      aria-label={`${text}. Copiar ${label}`}
      onClick={onClick}
    >
      {icon && <ChainIcon />}
      {text}
      {state !== "idle" && (
        <span className="copied" role="status">{state === "failed" ? "No se pudo copiar" : isLink ? "¡Enlace copiado!" : "¡Copiado!"}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------- connection

/** 6×6 pixel dot, pulsing: green good, yellow slow, red bad/reconnecting. */
export function ConnectionDot({ quality, status, latencyMs, label = true }: {
  quality: "good" | "slow" | "bad"; status: string; latencyMs: number | null; label?: boolean;
}) {
  const level = status !== "open" ? "bad" : quality;
  const text = level === "good" ? "En línea" : level === "slow" ? "Conexión lenta" : "Reconectando…";
  const art = ["..##..", ".####.", "######", "######", ".####.", "..##.."];
  return (
    <span className={`connection ${level}`} title={latencyMs !== null && status === "open" ? `${text} · ${latencyMs} ms` : text} role="status">
      <svg className="dot" viewBox="0 0 6 6" width="12" height="12" shapeRendering="crispEdges" aria-hidden>
        {art.flatMap((row, y) =>
          [...row].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)),
        )}
      </svg>
      {label ? <span>{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}
