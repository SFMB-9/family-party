// Bundles the Lambda into a single ESM file: dist/index.mjs (handler: "index.handler").
import { build } from "esbuild";

await build({
  entryPoints: ["src/handler.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node22",          // must match the Lambda runtime in Terraform
  format: "esm",
  minify: true,
  sourcemap: true,           // readable stack traces (needs NODE_OPTIONS=--enable-source-maps)
  // Some AWS SDK internals still call require(); ESM has no require, so give it one.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
