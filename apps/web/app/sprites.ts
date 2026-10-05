/**
 * Sprite sheets, sliced like Unity did in the 2023 game: 16×16 cells, 5 per row, filled row by row.
 * Draw the whole sheet as one PNG; code refers to a sprite by its cell index.
 * Placeholders to draw over come from tools/build-sprite-templates.py.
 */
export const CELL = 16;
export const SHEET_COLUMNS = 5;

/** Top-left pixel of cell `index` inside its sheet. */
export function cellOrigin(index: number, columns = SHEET_COLUMNS): { x: number; y: number } {
  return { x: (index % columns) * CELL, y: Math.floor(index / columns) * CELL };
}

/** Pixel size of a sheet holding `cells` sprites. */
export function sheetSize(cells: number, columns = SHEET_COLUMNS): { width: number; height: number } {
  return { width: columns * CELL, height: Math.ceil(cells / columns) * CELL };
}
