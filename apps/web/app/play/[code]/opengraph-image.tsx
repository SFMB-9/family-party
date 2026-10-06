import { ImageResponse } from "next/og";
import { isRoomCode } from "@family-party/protocol";
import { OG_SIZE, ogFonts } from "../../og/card";
import { BRAND } from "../../brand";

export const alt = `Únete a la partida en ${BRAND}`;
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * Per-room preview: "Únete a la sala ABCD". Only a real room-code shape is drawn,
 * so nobody can make the site render arbitrary text by sharing /play/<anything>.
 */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const raw = (await params).code.toUpperCase();
  const code = isRoomCode(raw) ? raw : null;
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
          gap: 24,
          background: "#111817",
          color: "#f2f2f2",
        }}
      >
        <div style={{ display: "flex", fontFamily: "Milanes Pixel", fontSize: 48, color: "#b9c2bf" }}>{BRAND.toUpperCase()}</div>
        <div style={{ display: "flex", fontFamily: "Milanes Pixel", fontSize: 72 }}>
          {code ? "ÚNETE A LA SALA" : "ÚNETE A LA PARTIDA"}
        </div>
        {code && (
          <div style={{ display: "flex", fontFamily: "Milanes Pixel", fontSize: 192, color: "#ffcf4a", letterSpacing: 12 }}>
            {code}
          </div>
        )}
        <div style={{ display: "flex", fontFamily: "Jersey 10", fontSize: 37.333 * 1.5, color: "#b9c2bf" }}>
          Toca el enlace, escribe tu nombre y listo
        </div>
      </div>
    ),
    { ...size, fonts: await ogFonts() },
  );
}
