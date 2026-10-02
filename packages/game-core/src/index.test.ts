import { describe, expect, it } from "vitest";
import { GAME_CORE_VERSION } from "./index";

describe("game-core", () => {
  it("is wired up", () => {
    expect(GAME_CORE_VERSION).toBe("0.0.0");
  });
});