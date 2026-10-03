import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

/** Vercel exposes the production domain at build time; locally, previews point at localhost. */
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

const description = "Trivia en familia, desde el celular. Una pantalla para todos, un celular por jugador.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Family Party", template: "%s · Family Party" },
  description,
  applicationName: "Family Party",
  openGraph: { type: "website", siteName: "Family Party", locale: "es_MX", title: "Family Party", description },
  twitter: { card: "summary_large_image", title: "Family Party", description },
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
