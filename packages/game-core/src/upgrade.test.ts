import { describe, expect, it } from "vitest";
import { initialState } from "./reducer";
import { DEFAULT_RULES } from "./rules";
import { upgradeState, upgradeView } from "./upgrade";
import { publicView } from "./view";
import type { GameState } from "./types";

describe("upgradeState", () => {
  it("fills fields older rooms don't have, keeping the old behavior", () => {
    const { rules: _r, encore: _e, played: _p, ...old } = initialState();
    const s = upgradeState(old as Partial<GameState>);
    expect(s.rules).toEqual(DEFAULT_RULES);
    expect(s.encore).toEqual([]);
    expect(s.played).toEqual([]);
  });

  it("keeps rules that were saved, and completes partial ones", () => {
    const s = upgradeState({ ...initialState(), rules: { steals: "off" } as GameState["rules"] });
    expect(s.rules).toEqual({ ...DEFAULT_RULES, steals: "off" });
  });

  it("gives an old board its columns by category", () => {
    const card = (id: string, category: string) => ({ id, category, questionId: id, value: 100, played: false });
    const board = [card("a", "Historia"), card("b", "Historia"), card("c", "Cine")] as GameState["board"];
    expect(upgradeState({ ...initialState(), board }).board.map((c) => c.column)).toEqual([0, 0, 1]);
  });

  it("leaves current state alone", () => {
    const current = initialState();
    expect(upgradeState(current)).toEqual(current);
  });
});

describe("upgradeView", () => {
  it("lets a newer client read a snapshot from an older server", () => {
    const { rules: _r, encore: _e, ...old } = publicView(initialState());
    const v = upgradeView(old as ReturnType<typeof publicView>);
    expect(v.rules).toEqual(DEFAULT_RULES);
    expect(v.encore).toEqual([]);
  });
});
