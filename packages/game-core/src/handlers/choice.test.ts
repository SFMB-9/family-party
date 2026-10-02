import { describe, expect, it } from "vitest";
import { createRng } from "../random";
import type { ChoiceSpec } from "../types";
import { choiceHandler } from "./choice";

// "¿Cuál de estos personajes NO pertenece a Avatar?"
const spec: ChoiceSpec = {
  kind: "choice",
  options: ["Aang", "Katara", "Sokka", "Zuko", "Goku"],
  correct: [4],
};

describe("prepare (shuffle options at deal time)", () => {
  it("keeps the same options", () => {
    const p = choiceHandler.prepare(spec, createRng(42));
    expect([...p.options].sort()).toEqual([...spec.options].sort());
  });

  it("keeps `correct` pointing at the same text after shuffling", () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = choiceHandler.prepare(spec, createRng(seed));
      expect(p.correct.map((i) => p.options[i])).toEqual(["Goku"]);
    }
  });

  it("does not mutate the original spec", () => {
    const before = structuredClone(spec);
    choiceHandler.prepare(spec, createRng(1));
    expect(spec).toEqual(before);
  });
  it("handles duplicate option texts", () => {
  const dup: ChoiceSpec = { kind: "choice", options: ["Sí", "Sí", "No"], correct: [0, 1] };
  for (let seed = 0; seed < 20; seed++) {
    const p = choiceHandler.prepare(dup, createRng(seed));
    expect(new Set(p.correct).size).toBe(2);
  }
});
});

describe("redact (what phones get to see)", () => {
  it("removes the correct answers", () => {
    const r = choiceHandler.redact(spec);
    expect(r).toEqual({ kind: "choice", options: spec.options });
    expect("correct" in r).toBe(false);
  });
});

describe("isValidAnswer (untrusted input from a phone)", () => {
  it.each([0, 4])("accepts %s", (a) => {
    expect(choiceHandler.isValidAnswer(spec, a)).toBe(true);
  });
  it.each([-1, 5, 1.5, NaN, "2", null, undefined])("rejects %s", (a) => {
    expect(choiceHandler.isValidAnswer(spec, a)).toBe(false);
  });
});

describe("isCorrect", () => {
  it("accepts the right choice and rejects the rest", () => {
    expect(choiceHandler.isCorrect(spec, 4)).toBe(true);
    expect(choiceHandler.isCorrect(spec, 0)).toBe(false);
  });
  it("accepts any of several correct choices", () => {
    const multi: ChoiceSpec = { ...spec, correct: [0, 2] };
    expect(choiceHandler.isCorrect(multi, 0)).toBe(true);
    expect(choiceHandler.isCorrect(multi, 2)).toBe(true);
    expect(choiceHandler.isCorrect(multi, 1)).toBe(false);
  });
});