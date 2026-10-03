import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS } from "@family-party/game-core";
import { PACKS, catalog, selectQuestions, toGameQuestion, validatePack, type Pack } from "./index";
import { decodeUnityIntList, importUnityAsset } from "./unity";

describe("built-in packs", () => {
  it.each(PACKS.map((p) => [p.id, p] as const))("%s is valid", (_id, pack) => {
    expect(validatePack(pack)).toEqual([]);
  });

  it("question ids are unique across all packs", () => {
    const ids = PACKS.flatMap((p) => p.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the classic pack can fill a full board for up to 8 players", () => {
    const perCategory = catalog().find((p) => p.id === "clasico")!.categories;
    expect(perCategory.filter((c) => c.count >= 8).length).toBeGreaterThanOrEqual(BOARD_COLUMNS);
  });
});

describe("selectQuestions", () => {
  const pack: Pack = {
    id: "test",
    name: "Test",
    description: "",
    questions: [
      { id: "a", category: "Uno", text: "A", options: ["x", "y"], correct: [0], difficulty: 1, timeLimitSec: 20, stealable: true },
      { id: "b", category: "Dos", text: "B", options: ["x", "y"], correct: [0], difficulty: 1, timeLimitSec: 20, stealable: true },
      { id: "c", category: "Uno", text: "C", options: ["x", "y"], correct: [0], difficulty: 1, timeLimitSec: 20, stealable: true, hidden: true },
    ],
  };

  it("never includes hidden questions", () => {
    expect(selectQuestions({}, [pack]).map((q) => q.id)).toEqual(["a", "b"]);
  });

  it("filters by category", () => {
    expect(selectQuestions({ categories: ["Dos"] }, [pack]).map((q) => q.id)).toEqual(["b"]);
  });

  it("filters by pack", () => {
    const other: Pack = { ...pack, id: "otro", questions: [{ ...pack.questions[0]!, id: "z" }] };
    expect(selectQuestions({ packs: ["otro"] }, [pack, other]).map((q) => q.id)).toEqual(["z"]);
  });

  it("converts seconds to milliseconds and keeps the points override", () => {
    const q = toGameQuestion({ ...pack.questions[0]!, timeLimitSec: 15, points: 250 });
    expect(q.timeLimitMs).toBe(15_000);
    expect(q.points).toBe(250);
  });
});

describe("catalog", () => {
  it("never leaks answers", () => {
    expect(JSON.stringify(catalog())).not.toMatch(/correct|options/);
  });
});

describe("Unity importer", () => {
  it("decodes packed little-endian int lists", () => {
    expect(decodeUnityIntList("00000000")).toEqual([0]);
    expect(decodeUnityIntList("03000000")).toEqual([3]);
    expect(decodeUnityIntList("0300000001000000")).toEqual([3, 1]);
  });

  it("converts a Unity asset (synthetic fixture with every real-world quirk)", () => {
    const text = readFileSync(new URL("./__fixtures__/QuestionBank.asset", import.meta.url), "utf8");
    const pack = importUnityAsset(text, { id: "importado", name: "Importado" });

    expect(validatePack(pack)).toEqual([]);
    expect(pack.questions).toHaveLength(2);

    const [club, avatar] = pack.questions;
    expect(club!.text).toBe("¿Cuándo se fundó el club de ajedrez del pueblo?"); // \xBF, \xE1, \xF3 decoded
    expect(club!.category).toBe("Familia");
    expect(club!.correct).toEqual([0]);
    expect(club!.difficulty).toBe(2);                                     // Unity's 0 = unset
    expect(club!.timeLimitSec).toBe(10);

    expect(avatar!.text).toContain("Avatar: The Last Airbender?");          // folded line joined
    expect(avatar!.options[avatar!.correct[0]!]).toBe("Obito Uchiha");
    expect(avatar!.points).toBe(200);
  });
});
