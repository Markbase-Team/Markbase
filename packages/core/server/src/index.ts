// Code that runs on the web server and nowhere else: API keys, the caller a
// request resolves to, feature gates that need the database, the MCP OAuth
// tokens, the skill bundle, generated-file bookkeeping, and the model client.
//
// Named for WHERE it runs. apps/web imports it from routes and server
// components; feature packages import it from their handlers/ and server/
// layers. The CLI, the desktop app, the runner, the vault and flows do not —
// what the user's machine needs stays in @markbase/node. Nothing here may be
// imported from a "use client" file (package-boundary.test.ts lists this
// package in NODE_PKGS).
//
// The barrel carries api-keys only, which is what the old @markbase/node barrel
// re-exported from this half. Everything else is subpath-only, as it was:
// caller, features, generated-files, mcp-oauth, skill-bundle, llm.

export * from "./api-keys";
