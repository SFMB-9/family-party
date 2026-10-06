import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { BRAND } from "./brand";

/** Vercel exposes the production domain at build time; locally, previews point at localhost. */
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

const description = "Trivia en familia, desde el celular. Una pantalla para todos, un celular por jugador.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: BRAND, template: `%s · ${BRAND}` },
  description,
  applicationName: BRAND,
  openGraph: { type: "website", siteName: BRAND, locale: "es_MX", title: BRAND, description },
  twitter: { card: "summary_large_image", title: BRAND, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f4a3c", // board teal: tints the phone browser bar
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
