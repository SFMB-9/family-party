import { describe, expect, it } from "vitest";
import { hashCode, normalizeCode, parsePrivatePack, verifyCode } from "./packs";

const FAST = { N: 2 ** 10, r: 8, p: 1 }; // tests don't need a slow hash

describe("normalizeCode", () => {
  it("ignores case, accents, spacing and punctuation: only letters and digits count", () => {
    expect(normalizeCode("TAMALESABUELA26")).toBe("tamalesabuela26");
    expect(normalizeCode("  tamales abuela, 26! ")).toBe("tamalesabuela26");
    expect(normalizeCode("Tamales-Abuela-26")).toBe("tamalesabuela26");
    expect(normalizeCode("AñoNuevoOaxaca")).toBe("anonuevooaxaca");
  });
});

describe("hashCode / verifyCode", () => {
  it("accepts the code in any form, rejects anything else", async () => {
    const access = await hashCode("TAMALESABUELA26", FAST);
    expect(access.hash).not.toContain("tamales"); // obviously, but: only the hash is stored
    expect(await verifyCode("tamales abuela 26", access)).toBe(true);
    expect(await verifyCode("TAMALESABUELA25", access)).toBe(false);
  });

  it("salts every hash: the same code locks two packs differently", async () => {
    const [a, b] = await Promise.all([hashCode("misma clave larga", FAST), hashCode("misma clave larga", FAST)]);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("parsePrivatePack", () => {
  const question = { id: "f1", category: "Viajes", text: "¿A dónde?", options: ["A", "B"], correct: [0], difficulty: 1, timeLimitSec: 20, stealable: true };

  it("accepts a valid locked pack", async () => {
    const access = await hashCode("clave muy larga de prueba", FAST);
    const parsed = parsePrivatePack({ id: "familia", name: "Familia", description: "", questions: [question], access });
    expect(parsed.ok).toBe(true);
  });

  it("rejects a pack without an access block, a broken question, or a clash with a built-in id", () => {
    const noAccess = parsePrivatePack({ id: "familia", name: "Familia", description: "", questions: [question] });
    expect(noAccess.ok).toBe(false);
    const broken = parsePrivatePack({ id: "x", name: "X", description: "", questions: [{ ...question, correct: [9] }], access: {} });
    expect(broken.ok || broken.errors.some((e) => e.includes("out of range"))).toBe(true);
    const clash = parsePrivatePack({ id: "clasico", name: "Yo", description: "", questions: [question] });
    expect(clash.ok || clash.errors.some((e) => e.includes("built-in"))).toBe(true);
  });
});
