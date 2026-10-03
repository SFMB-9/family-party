import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages export TypeScript source; Next compiles them as part of the app.
  transpilePackages: ["@family-party/game-core", "@family-party/protocol"],
  // Dev server only: let other devices on my network load the dev build.
  allowedDevOrigins: ["100.74.88.5"],
};

export default config;
