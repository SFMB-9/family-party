import { describe, expect, it } from "vitest";
import { createRng, shuffle } from "./random";

describe("createRng", () => {
  it("is deterministic for a seed", () => {
    const a = createRng(42), b = createRng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it("differs across seeds", () => {
    expect(createRng(1)()).not.toEqual(createRng(2)());
  });
  it("stays in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("shuffle", () => {
  const items = ["a", "b", "c", "d", "e"];
  it("returns a permutation", () => {
    expect(shuffle(items, createRng(3)).sort()).toEqual([...items].sort());
  });
  it("does not mutate the input", () => {
    const copy = [...items];
    shuffle(items, createRng(3));
    expect(items).toEqual(copy);
  });
  it("is deterministic for a seed", () => {
    expect(shuffle(items, createRng(9))).toEqual(shuffle(items, createRng(9)));
  });
});