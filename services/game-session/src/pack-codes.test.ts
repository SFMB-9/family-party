import { describe, expect, it } from "vitest";
import { codeChange, codesPath, entryProblem, parseCodes } from "./pack-codes";
import { hashCode } from "./packs";

const FAST = { N: 2 ** 10, r: 8, p: 1 };

describe("codesPath", () => {
  it("defaults to ~/.family-party/codes.json and honours PACK_CODES_FILE", () => {
    expect(codesPath({}, "/home/salva").replace(/\\/g, "/")).toBe("/home/salva/.family-party/codes.json");
    expect(codesPath({ PACK_CODES_FILE: "D:/otro.json" }, "/home/salva")).toBe("D:/otro.json");
  });
});

describe("parseCodes", () => {
  it("reads entries by id and skips _notes", () => {
    const parsed = parseCodes({ _ayuda: "notas", "milanes-party": { name: "Milanés Party", code: "" } });
    expect(parsed.ok && [...parsed.value.keys()]).toEqual(["milanes-party"]);
  });

  it("reports malformed entries by id, never echoing a code", () => {
    const parsed = parseCodes({ familia: { name: "Familia", code: 26 }, otro: "CLAVESECRETA26" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toHaveLength(2);
      expect(parsed.errors.join(" ")).not.toContain("CLAVESECRETA26");
    }
    expect(parseCodes([]).ok).toBe(false);
  });
});

describe("entryProblem", () => {
  it("asks for unknown ids, empty and short codes", () => {
    expect(entryProblem("x", undefined)).toMatch(/isn't in the codes file/);
    expect(entryProblem("x", { name: "X", code: "" })).toMatch(/no code yet/);
    expect(entryProblem("x", { name: "X", code: "corta" })).toMatch(/too short/);
    expect(entryProblem("x", { name: "X", code: "tamales abuela 26" })).toBeNull();
  });
});

describe("codeChange", () => {
  it("tells a new pack, the same code (in any form) and a changed code apart", async () => {
    const access = await hashCode("TAMALESABUELA26", FAST);
    expect(await codeChange("TAMALESABUELA26", undefined)).toBe("new");
    expect(await codeChange("tamales-abuela 26", access)).toBe("same");
    expect(await codeChange("TAMALESABUELA27", access)).toBe("changed");
  });
});
