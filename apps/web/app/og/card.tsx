/**
 * Share-preview cards (Discord, WhatsApp, X), drawn with ImageResponse.
 * Same language as the game: phase colors, Salva's pixel font for the loud parts,
 * Jersey 10 for the sentence. Fonts are TTF copies (ImageResponse can't read woff2).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OG_SIZE = { width: 1200, height: 630 };

const font = (file: string) => readFile(join(process.cwd(), "assets/fonts", file));

export async function ogFonts() {
  const [pixel, body] = await Promise.all([font("milanes-pixel.ttf"), font("jersey-10.ttf")]);
  return [
    { name: "Milanes Pixel", data: pixel, style: "normal" as const, weight: 400 as const },
    { name: "Jersey 10", data: body, style: "normal" as const, weight: 400 as const },
  ];
}

const VALUES = ["$100", "$200", "$300", "$200", "$100"];

/** A row of grey value cards, like the board. */
export function CardRow({ highlight }: { highlight?: number }) {
  return (
    <div style={{ display: "flex", gap: 18 }}>
      {VALUES.map((v, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 168,
            height: 96,
            background: "#8c8c8c",
            borderRight: "8px solid #6f6f6f",
            borderBottom: "8px solid #6f6f6f",
            outline: i === highlight ? "8px solid #ffcf4a" : "none",
            color: "#1b1b1b",
            fontFamily: "Milanes Pixel",
            fontSize: 48,
          }}
        >
          {v}
        </div>
      ))}
    </div>
  );
}
