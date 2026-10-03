import type { Metadata } from "next";
import type { ReactNode } from "react";
import { isRoomCode } from "@family-party/protocol";

/** The play page is a client component; its title and share text live here. */
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const raw = (await params).code.toUpperCase();
  const code = isRoomCode(raw) ? raw : null;
  const title = code ? `Sala ${code}` : "Únete a la partida";
  const description = code
    ? `¡Únete a la sala ${code} de Family Party! Trivia en familia, desde el celular.`
    : "Trivia en familia, desde el celular.";
  // openGraph/twitter replace the root layout's objects (no deep merge), so repeat the shared fields.
  return {
    title,
    description,
    openGraph: { type: "website", siteName: "Family Party", locale: "es_MX", title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default function PlayLayout({ children }: { children: ReactNode }) {
  return children;
}
