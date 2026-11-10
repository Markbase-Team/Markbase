import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The shell had no tests. It now holds the auth gate — the one place that
// decides whether a request reaches a feature at all — so it needs somewhere
// to prove that gate behaves.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: { environment: "node", include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
});
