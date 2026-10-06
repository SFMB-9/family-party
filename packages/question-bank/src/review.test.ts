import { describe, expect, it } from "vitest";
import { diffSheets, reviewSheet } from "./review";
import { parseCsv } from "./sheet";

const HEADER = "Rev,Categoría,Pregunta,Correcta,Incorrecta 1,Incorrecta 2,Nota\n";
const review = (body: string, min = 1) => reviewSheet(parseCsv(HEADER + body), { minPerCategory: min });
const kinds = (body: string, min = 1) => review(body, min).findings.map((f) => [f.kind, f.row]);

describe("reviewSheet", () => {
  it("passes a clean sheet and counts categories like the validator", () => {
    const r = review(",Viajes,¿Capital de Perú?,Lima,Quito,Bogotá,\n,,¿Capital de Chile?,Santiago,Lima,Quito,\n");
    expect(r.findings).toEqual([]);
    expect(r.categories).toEqual([{ name: "Viajes", count: 2 }]);
  });

  it("reports validator errors with their row", () => {
    expect(kinds(",Viajes,¿Sin respuesta?,,Quito,,\n")).toContainEqual(["error", 2]);
  });

  it("flags small categories, Rev marks and notes that ask for a check (but not finished ones)", () => {
    const body =
      "★?,Viajes,¿A?,Sí,No,,\n" +
      ",,¿B?,Sí,No,,Revisa los distractores\n" +
      ",,¿C?,Sí,No,,Confirmado en el árbol\n";
    expect(kinds(body, 12)).toEqual([["small-category", undefined], ["unfinished", 2], ["check-note", 3]]);
  });

  it("flags the same question in another category, and long-answer giveaways", () => {
    const body = ",Viajes,¿Dónde?,Aquí,Allá,,\n,Fechas,¿Dónde?,Aquí,Allá,,\n,,¿Por qué?,Porque así lo decidimos todos juntos,Sí,No,\n";
    expect(kinds(body)).toEqual([["duplicate", 3], ["giveaway", 4]]);
  });

  it("matches privacy words at the start of a word only", () => {
    expect(kinds(",Chismes,¿Quién sacó el saco?,Ana,Bea,,\n")).toEqual([]);
    expect(kinds(",Chismes,¿Por qué?,Porque la odia,Por nada,,\n")).toEqual([["sensitive", 2]]);
    expect(kinds(",Casas,¿Dónde vive?,Calle Pino 23,Calle Roble 4,,\n")).toEqual([["address", 2]]);
    expect(kinds(",Casas,¿Qué colonia?,Del Valle,Roma,,\n")).toEqual([["address", 2]]);
    expect(kinds(",Varios,¿Código?,TAMALESABUELA26,Otro,,\n")).toContainEqual(["secret", 2]);
  });

  it("takes extra sensitive words from the caller (a local list, not this public repo)", () => {
    const rows = parseCsv(HEADER + ",Chismes,¿Qué pasó en Tulum?,Lo del yate,Nada,,\n");
    expect(reviewSheet(rows, { minPerCategory: 1 }).findings).toEqual([]);
    expect(reviewSheet(rows, { minPerCategory: 1, sensitiveWords: ["Yate"] }).findings.map((f) => f.kind)).toEqual(["sensitive"]);
  });
});

describe("diffSheets", () => {
  const before = parseCsv(HEADER + ",Viajes,¿A?,Sí,No,,\n,,¿B?,Sí,No,,\n");
  it("ignores reordering, finds added, removed and changed questions", () => {
    const after = parseCsv(HEADER + ",Viajes,¿B?,Sí,Nop,,\n,,¿C?,Sí,No,,\n");
    const d = diffSheets(before, after);
    expect(d.added).toEqual([{ row: 3, text: "¿C?" }]);
    expect(d.removed).toEqual([{ row: 2, text: "¿A?" }]);
    expect(d.changed).toEqual([
      { row: 2, text: "¿B?", cells: [{ column: "Categoría", before: "", after: "Viajes" }, { column: "Incorrecta 1", before: "No", after: "Nop" }] },
    ]);
  });

  it("reports columns added and removed, and whether a removed one was empty", () => {
    const after = parseCsv("Categoría,Pregunta,Correcta,Incorrecta 1,Incorrecta 2,Dato\nViajes,¿A?,Sí,No,,\n,¿B?,Sí,No,,\n");
    const d = diffSheets(before, after);
    expect(d.columnsAdded).toEqual(["Dato"]);
    expect(d.columnsRemoved).toEqual([{ name: "Rev", empty: true }, { name: "Nota", empty: true }]);
  });
});
