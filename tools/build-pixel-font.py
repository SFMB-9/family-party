"""
Builds apps/web/public/fonts/milanes-pixel.woff2 from Salva's hand-drawn sprite font
(Sprite-0006.png from the 2023 Unity project: 16x6 grid of 8x12 cells).

Every filled pixel becomes a square in the font outline, so the font stays perfectly
crisp at multiples of 12px. Glyphs Salva never drew ($ + - /) are defined below in the same style.

  python3 tools/build-pixel-font.py <path/to/Sprite-0006.png>
"""
import sys
from PIL import Image
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

PX = 100                     # font units per sprite pixel
CELL_W, CELL_H = 8, 12
BASELINE = 11                # body occupies rows 4..10 of each cell; row 11 is the descender
UPM = CELL_H * PX            # 1 em = 12 pixels → crisp at 12, 24, 36… px

GRID = [
    "ABCDEFGHIJKLMNOP",
    "QRSTUVWXYZÁÉÍÓÚ.",
    "ÄËÏÖÜ0123456789,",
    "abcdefghijklmnop",
    "qrstuvwxyzáéíóú:",
    "äëïöüñÑ!¡¿?´\"'_;",
]

EXTRA = {  # rows 0..11 of an 8-wide cell, same 2px-stroke style
    "$": ["", "", "", "...##", ".######", "#######", "##.##", "#######", "...####", "#######", "######", "...##"],
    "+": ["", "", "", "", "..##", "..##", "######", "######", "..##", "..##", "", ""],
    "-": ["", "", "", "", "", "", "#####", "#####", "", "", "", ""],
    "/": ["", "", "", "", ".....##", "....##", "...##", "..##", ".##", "##", "#", ""],
}

def cells_from_sprite(path):
    im = Image.open(path).convert("RGBA")
    px = im.load()
    glyphs = {}
    for r, row in enumerate(GRID):
        for c, ch in enumerate(row):
            bits = [[px[c * CELL_W + x, r * CELL_H + y][3] > 0 for x in range(CELL_W)] for y in range(CELL_H)]
            glyphs[ch] = bits
    for ch, rows in EXTRA.items():
        glyphs[ch] = [[(x < len(line) and line[x] == "#") for x in range(CELL_W)] for line in rows]
    return glyphs

def draw(bits):
    """Outline from horizontal runs per pixel row (clockwise squares; TrueType outer contours)."""
    xs = [x for row in bits for x, on in enumerate(row) if on]
    if not xs:
        return None, 4 * PX
    min_x, max_x = min(xs), max(xs)
    pen = TTGlyphPen(None)
    for y, row in enumerate(bits):
        x = 0
        while x < CELL_W:
            if row[x]:
                start = x
                while x < CELL_W and row[x]:
                    x += 1
                x0, x1 = (start - min_x) * PX, (x - min_x) * PX
                top, bottom = (BASELINE - y) * PX, (BASELINE - y - 1) * PX
                pen.moveTo((x0, bottom)); pen.lineTo((x0, top)); pen.lineTo((x1, top)); pen.lineTo((x1, bottom)); pen.closePath()
            else:
                x += 1
    return pen.glyph(), (max_x - min_x + 2) * PX  # +1px letter spacing

def main(sprite, out):
    glyphs = cells_from_sprite(sprite)
    order = [".notdef", "space"] + [f"uni{ord(ch):04X}" for ch in glyphs]
    cmap = {32: "space", **{ord(ch): f"uni{ord(ch):04X}" for ch in glyphs}}

    empty = TTGlyphPen(None).glyph()
    outlines = {".notdef": empty, "space": empty}
    metrics = {".notdef": (4 * PX, 0), "space": (4 * PX, 0)}
    for ch, bits in glyphs.items():
        name = f"uni{ord(ch):04X}"
        g, adv = draw(bits)
        outlines[name] = g or empty
        metrics[name] = (adv, 0)

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(outlines)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=11 * PX, descent=-1 * PX)
    fb.setupOS2(sTypoAscender=11 * PX, sTypoDescender=-1 * PX, sTypoLineGap=PX, usWinAscent=11 * PX, usWinDescent=PX, achVendID="SFMB")
    fb.setupNameTable({"familyName": "Milanes Pixel", "styleName": "Regular", "psName": "MilanesPixel-Regular",
                       "copyright": "Glyphs drawn by Salvador Milanés (2023)"})
    fb.setupPost()
    fb.font.flavor = "woff2"
    fb.save(out)
    print(f"✓ {len(glyphs)} glyphs → {out}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "apps/web/public/fonts/milanes-pixel.woff2")
