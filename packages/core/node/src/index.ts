// Code for the user's machine, shared by the node hosts (the CLI, the desktop
// app, the runner): the Claude Code probe and session, the MCP and audit-hook
// installers, the loopback sign-in listener, and repo state.
//
// It is node-only (child_process, node:fs, node:http), but it is NOT the vault
// engine and NOT the job runner. Nothing here may be imported from a
// "use client" file.
//
// The web-server half that used to live here — api-keys, caller, features,
// generated-files, mcp-oauth, skill-bundle — is now @markbase/server.
//
// Three modules are still shared with the web server and stay here until that
// is decided: repo-state, repos and vercel-preview, which the runner and the
// projects feature's handlers both import.

export * from "./detect-claude";
export * from "./claude-code";
export * from "./repo-state";
export * from "./vercel-preview";
export * from "./repos";
export * from "./mcp-install";
export * from "./audit-hooks";

export {
  awaitDeviceAuth,
  DeviceAuthCanceledError,
  type DeviceAuthOptions,
} from "./device-auth";
