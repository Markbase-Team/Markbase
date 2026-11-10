// Node code shared by the web server and the node hosts: API keys, repo state,
// the Claude Code probe, and the loopback sign-in listener.
//
// It is node-only (child_process, node:crypto, zlib), but it is NOT the vault
// engine and NOT the job runner — apps/web imports it from server routes, which
// is why it is its own package rather than living in @markbase/runner. The rule
// is the one the old core/node entry stated: nothing here may be imported from a
// "use client" file.
//
// asset-refs and skill-bundle are deliberately absent: they were reachable only
// through the old "./*" wildcard, so they stay subpath-only rather than being
// promoted into a barrel by a mechanical move.

export * from "./api-keys";
export * from "./detect-claude";
export * from "./claude-code";
export * from "./repo-state";
export * from "./vercel-preview";
export * from "./repos";

export {
  awaitDeviceAuth,
  DeviceAuthCanceledError,
  type DeviceAuthOptions,
} from "./device-auth";
