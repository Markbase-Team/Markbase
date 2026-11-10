import { defineConfig } from "vitest/config";

// vite.config.mts is the renderer's build (root: src/renderer); vitest would
// otherwise inherit that root and find no tests. The main-process tests live
// in test/ and need nothing from Vite.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
