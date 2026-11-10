import { defineConfig } from "tsup";

// Bundle the Electron main process. The workspace packages (@markbase/*) ship TypeScript, so they must be inlined — Electron can't
// resolve them at runtime. `electron` is provided by the runtime, so it stays
// external.
export default defineConfig({
  // main = the Electron main process; preload = the contextBridge the renderer
  // sees as window.markbase (built to dist/preload.js, loaded by createWindow).
  entry: { main: "src/main.ts", preload: "src/preload.ts" },
  format: ["cjs"],
  target: "node20",
  platform: "node",
  bundle: true,
  clean: true,
  // Workspace TS packages must be inlined (Electron can't resolve them at runtime).
  noExternal: [
    "@markbase/protocol",
    "@markbase/node",
    "@markbase/vault",
    "@markbase/runner",
    "@markbase/docs",
    "@markbase/agent",
    "@markbase/flows",
  ],
  // Loaded at runtime from node_modules, not bundled: electron is the runtime,
  // node-pty is a prebuilt N-API
  // native module, and the Claude Agent SDK is ESM-only — it must stay a runtime
  // dynamic import() (see loadClaudeAgentSdk), never a bundled require().
  external: ["electron", "node-pty", "@anthropic-ai/claude-agent-sdk"],
  // The docs package imports SKILL.md-style raw text; inline it as a string.
  // The onboarding screen is inlined the same way, and the tray icon as a data
  // URL, so the built main.js carries its own UI and there is no asset to copy
  // into the app bundle separately.
  esbuildOptions(options) {
    options.loader = { ...options.loader, ".md": "text", ".html": "text", ".png": "dataurl" };
  },
});
