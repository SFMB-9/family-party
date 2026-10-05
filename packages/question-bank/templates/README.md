# Templates

## `plantilla.csv`

The spreadsheet format for a question pack. Import it into Google Sheets, fill it in, export it as CSV and run `pack-sheet`.

## `avatars-template.png`: a theme's avatar sheet

Copy it, draw over it, and keep your copy next to the pack's CSV in `private-packs/` (gitignored). Portraits of real people never go in this repo.

- **Grid:** 16×16 cells, 5 per row, filled row by row. That's the 2023 Unity convention (`Royal.png`), and the game slices it the same way.
- **Cell 0 is the fallback.** It keeps the "?" from 2023 and is shown for any player the theme doesn't map. You can redraw it, but don't put a person there.
- **Cells 1 and up are faces,** in any order. The theme maps names to cells (for example `"Matere": 1`), so the order only matters to you. The faint bust shows where the 2023 faces sit; the numbers are guides to draw over.
- **Size:** the template has 6 rows (29 faces). Add rows at the bottom if you need more; keep it 5 columns wide.
- **One version per face.** Selected, dimmed and highlighted states are drawn by the game (outline, filter), so there's no need for the 2023 `Selected` and `Unhighlight` copies.
- Draw at 1× and export PNG with no smoothing. The game scales by whole numbers (2×, 3×, 9×) so pixels stay crisp.

## The For Nerds icons

Not a theme, but the same convention: `apps/web/public/sprites/arch.png`, one cell per node in `ARCH_SHEET` order (`apps/web/app/nerds.tsx`). The placeholder numbers each cell:

| Cell | Icon | Cell | Icon |
|---|---|---|---|
| 0 | players (phones + TV) | 5 | s3 |
| 1 | vercel | 6 | iam |
| 2 | apigw (API Gateway) | 7 | budget |
| 3 | lambda | 8 | actions (GitHub Actions) |
| 4 | dynamodb | 9 | tfstate (Terraform state) |

New icons go at the end, so existing cells never move.

`python3 tools/build-sprite-templates.py` regenerates both placeholder sheets. It overwrites them, so only run it to reset one.
