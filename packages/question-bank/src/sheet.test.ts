import { describe, expect, it } from "vitest";
import { parseCsv, sheetToPack, slugify, SHEET_DEFAULTS } from "./sheet";

const META = { id: "prueba", name: "Prueba" };
const build = (csv: string) => sheetToPack(parseCsv(csv), META);

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, newlines inside quotes, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n"two\nlines",z\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["two\nlines", "z"]]);
  });

  it("detects semicolon exports (Excel in some locales)", () => {
    expect(parseCsv("Pregunta;Correcta\n¿1,5 o 2?;2")).toEqual([["Pregunta", "Correcta"], ["¿1,5 o 2?", "2"]]);
  });
});

describe("sheetToPack", () => {
  it("builds questions with the correct answer first and defaults for empty cells", () => {
    const { pack, errors, notes } = build(
      "Categoría,Pregunta,Correcta,Incorrecta 1,Incorrecta 2,Dificultad,Segundos,Robable\n" +
        "Viajes,¿Capital de Perú?,Lima,Quito,Bogotá,2,30,no\n" +
        ",¿Capital de Chile?,Santiago,Lima,,,,\n",
    );
    expect(errors).toEqual([]);
    expect(pack.questions).toHaveLength(2);
    expect(pack.questions[0]).toMatchObject({ category: "Viajes", options: ["Lima", "Quito", "Bogotá"], correct: [0], difficulty: 2, timeLimitSec: 30, stealable: false });
    // Empty category repeats the row above; empty cells take the defaults; empty Incorrecta 2 is skipped.
    expect(pack.questions[1]).toMatchObject({
      category: "Viajes",
      options: ["Santiago", "Lima"],
      difficulty: SHEET_DEFAULTS.difficulty,
      timeLimitSec: SHEET_DEFAULTS.timeLimitSec,
      stealable: true,
    });
    expect(notes.join(" ")).toMatch(/1 sin categoría/);
  });

  it("matches headers loosely and finds them below a title row", () => {
    const { pack, errors } = build("Preguntas de la familia,,\nTEMA,pregunta,Respuesta correcta,Opción 1,Tiempo\nApodos,¿Quién es Pepe?,José,Juan,sin\n");
    expect(errors).toEqual([]);
    expect(pack.questions[0]).toMatchObject({ category: "Apodos", options: ["José", "Juan"], timeLimitSec: null });
  });

  it("keeps ids stable when rows move or answers change", () => {
    const a = build("Categoría,Pregunta,Correcta,Incorrecta 1\nA,Uno,1,2\nA,Dos,2,3\n").pack.questions;
    const b = build("Categoría,Pregunta,Correcta,Incorrecta 1\nA,Dos,dos,tres\nA,Uno,1,2\n").pack.questions;
    expect(b.find((q) => q.text === "Uno")!.id).toBe(a[0]!.id);
    expect(b.find((q) => q.text === "Dos")!.id).toBe(a[1]!.id);
    expect(a[0]!.id).toMatch(/^a-[0-9a-z]{7}$/);
  });

  it("reports every problem with the row number the spreadsheet shows", () => {
    const { errors } = build(
      "Categoría,Pregunta,Correcta,Incorrecta 1,Dificultad,Segundos,Robable\n" +
        "A,,x,y\n" + // row 2: no question
        "A,Sin correcta,,y\n" + // row 3
        "A,Repetidas,Sí,si\n" + // row 4: same answer twice (ignoring accents)
        "A,Mala,x,y,7,3,quizá\n" + // row 5: three bad cells
        "A,Doble,x,y\n" +
        "A,doble,x,y\n", // row 7: duplicate question
    );
    expect(errors).toEqual([
      "Fila 2: falta la pregunta.",
      "Fila 3: falta la respuesta correcta.",
      "Fila 4: hay respuestas repetidas.",
      expect.stringMatching(/^Fila 5: la dificultad .*; los segundos .*; robable .*\.$/),
      'Fila 7: esta pregunta ya está arriba en "A".',
    ]);
  });

  it("explains missing columns and empty sheets", () => {
    expect(build("Pregunta,Correcta\nHola,Sí\n").errors).toEqual(['Falta al menos una columna "Incorrecta 1".']);
    expect(build("Nombre,Edad\n").errors[0]).toMatch(/encabezados/);
    expect(build("Pregunta,Correcta,Incorrecta 1\n,,\n").errors).toEqual(["La hoja no tiene preguntas."]);
  });
});

describe("slugify", () => {
  it("makes ids from names", () => {
    expect(slugify("Familia Milanés — 2026!")).toBe("familia-milanes-2026");
    expect(slugify("¿?")).toBe("x");
  });
});
