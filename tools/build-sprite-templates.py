"""
Builds the placeholder sprite sheets you draw over.

Every sheet follows the 2023 Unity convention: 16x16 cells, 5 per row, filled row by row,
and the game slices it by cell index (apps/web/app/sprites.ts).

  apps/web/public/sprites/arch.png                       the For Nerds icons, in ARCH_SHEET order (nerds.tsx)
  packages/question-bank/templates/avatars-template.png  starting point for a theme's avatar sheet

  python3 tools/build-sprite-templates.py

Running it again overwrites both files, so only run it to reset a sheet.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CELL, COLS = 16, 5

# Same order as ARCH_SHEET in apps/web/app/nerds.tsx.
ARCH = ["players", "vercel", "apigw", "lambda", "dynamodb", "s3", "iam", "budget", "actions", "tfstate"]
AVATAR_ROWS = 6  # 30 cells like Royal.png: the "?" fallback plus 29 faces

DIGITS = {  # 3x5
    "0": ["###", "#.#", "#.#", "#.#", "###"], "1": [".#.", "##.", ".#.", ".#.", "###"],
    "2": ["###", "..#", "###", "#..", "###"], "3": ["###", "..#", ".##", "..#", "###"],
    "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "###", "..#", "###"],
    "6": ["###", "#..", "###", "#.#", "###"], "7": ["###", "..#", ".#.", ".#.", ".#."],
    "8": ["###", "#.#", "###", "#.#", "###"], "9": ["###", "#.#", "###", "..#", "###"],
}

# The "?" from cell 0 of Salva's 2023 Royal.png: the fallback face every avatar sheet starts with.
QUESTION = [
    "................", ".......###......", ".....#######....", "....###...##....",
    "....##.....#....", ".....#....##....", ".........##.....", "........##......",
    ".......##.......", ".......##.......", "................", "................",
    "........#.......", ".......###......", "........#.......", "................",
]

# Head-and-shoulders guide, so new faces sit where the 2023 ones do.
BUST = [
    "................", ".....######.....", "....########....", "...##########...",
    "...##########...", "...##########...", "...##########...", "...##########...",
    "....########....", ".....######.....", "......####......", "......####......",
    "...##########...", ".##############.", "################", "################",
]

NAVY = (34, 32, 52, 255)      # background of the 2023 "?"
SKIN = (238, 195, 154, 255)   # its foreground
HUES = [(91, 110, 225), (95, 205, 228), (106, 190, 48), (251, 242, 54), (223, 113, 38),
        (217, 87, 99), (118, 66, 138), (155, 173, 183), (143, 151, 74), (99, 155, 255)]


def stamp(img, ox, oy, rows, color):
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            if c == "#":
                img.putpixel((ox + x, oy + y), color)


def number(img, ox, oy, n, color):
    for i, d in enumerate(str(n)):
        stamp(img, ox + i * 4, oy, DIGITS[d], color)


def sheet(cells):
    return Image.new("RGBA", (COLS * CELL, -(-cells // COLS) * CELL), (0, 0, 0, 0))


def origin(i):
    return (i % COLS) * CELL, (i // COLS) * CELL


def arch():
    img = sheet(len(ARCH))
    for i, _ in enumerate(ARCH):
        ox, oy = origin(i)
        hue = HUES[i % len(HUES)] + (255,)
        for y in range(CELL):
            for x in range(CELL):
                edge = x in (0, CELL - 1) or y in (0, CELL - 1)
                img.putpixel((ox + x, oy + y), hue if edge else NAVY)
        number(img, ox + (CELL - (4 * len(str(i)) - 1)) // 2, oy + 5, i, hue)
    return img


def avatars():
    img = sheet(AVATAR_ROWS * COLS)
    for i in range(AVATAR_ROWS * COLS):
        ox, oy = origin(i)
        # Checkerboard backgrounds so the cell edges show; draw your own background over them.
        bg = NAVY if (i % COLS + i // COLS) % 2 == 0 else (50, 60, 57, 255)
        for y in range(CELL):
            for x in range(CELL):
                img.putpixel((ox + x, oy + y), bg)
        if i == 0:
            stamp(img, ox, oy, QUESTION, SKIN)
        else:
            stamp(img, ox, oy, BUST, (63, 63, 116, 255))
            number(img, ox + 1, oy + 1, i, (155, 173, 183, 255))
    return img


if __name__ == "__main__":
    out = ROOT / "apps/web/public/sprites/arch.png"
    arch().save(out)
    print("wrote", out.relative_to(ROOT))
    out = ROOT / "packages/question-bank/templates/avatars-template.png"
    avatars().save(out)
    print("wrote", out.relative_to(ROOT))
