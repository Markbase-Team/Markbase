import { defineConfig } from "tsup";

// Build ONLY the migrate CLI to dist/cli.js. The library entrypoints
// (server / routes / ui) ship as TypeScript source and are compiled by the
// consuming Next app via `transpilePackages` — so they need no build step.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  // pg + node built-ins stay external (installed as a dependency).
});
