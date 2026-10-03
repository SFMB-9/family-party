import { initialState } from "./reducer";
import { DEFAULT_RULES } from "./rules";
import type { Card, GameState, PublicState } from "./types";

/**
 * Rooms are saved as JSON and live up to 12 h, so a deploy can meet state written by
 * older code. This fills in anything newer code expects, with the value that keeps the
 * old behavior. Add a line here whenever GameState gains a field.
 */
export function upgradeState(saved: Partial<GameState>): GameState {
  const state: GameState = {
    ...initialState(),
    ...saved,
    rules: { ...DEFAULT_RULES, ...saved.rules },   // added with house rules
    encore: saved.encore ?? [],                      // added with play-again
    played: saved.played ?? [],                      // added with play-again
    picks: saved.picks ?? [],                        // added with lobby picks (empty = legacy room selection)
  };
  return { ...state, board: withColumns(state.board) };
}

/**
 * The same, for what clients receive. Vercel deploys the web app as soon as a PR merges,
 * but the Lambda waits for approval: for a few minutes a newer client talks to an older server.
 */
export function upgradeView(view: PublicState): PublicState {
  const partial = view as Partial<PublicState> & PublicState;
  return {
    ...partial,
    rules: { ...DEFAULT_RULES, ...partial.rules },
    encore: partial.encore ?? [],
    picks: partial.picks ?? [],
    board: withColumns(partial.board),
  };
}

/** Boards dealt before cards had a `column`: one column per category, in deal order. */
function withColumns(board: Card[]): Card[] {
  if (board.every((c) => typeof c.column === "number")) return board;
  const order = [...new Set(board.map((c) => c.category))];
  return board.map((c) => ({ ...c, column: order.indexOf(c.category) }));
}
