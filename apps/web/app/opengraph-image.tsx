import { ImageResponse } from "next/og";
import { CardRow, OG_SIZE, ogFonts } from "./og/card";

export const alt = "Family Party: trivia en familia, desde el celular";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          background: "#0f4a3c",
          color: "#f2f2f2",
        }}
      >
        <div style={{ display: "flex", fontFamily: "Milanes Pixel", fontSize: 120 }}>FAMILY PARTY</div>
        <div style={{ display: "flex", fontFamily: "Jersey 10", fontSize: 56, color: "#ffcf4a" }}>
          Trivia en familia, desde el celular
        </div>
        <CardRow highlight={2} />
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
