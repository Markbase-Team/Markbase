// Code that runs on the user's machine and nowhere else: the CLI and the
// desktop app's main process load it, the web server and the browser never do.
//
// Named for WHERE it runs, with one folder per topic:
//   vault/   the sync engine: watcher, lock, mirror, registry, the sync run
//   runner/  the ticket worker: claim, heartbeat, execute, report, discover repos
//   flows/   sign in, mount, reconcile, asked through an Operator
// and, beside them, what both hosts need from the machine itself: the Claude
// Code probe and session, the MCP and audit-hook installers, and the loopback
// sign-in listener. This barrel carries that last group, as the old
// @markbase/node barrel did; the folders are imported by subpath
// (@markbase/local/vault, @markbase/local/runner, @markbase/local/flows).
//
// It talks to the web server over HTTP with an API key. It holds no database
// credential and must not import @markbase/server; nothing here may be imported
// from a "use client" file (package-boundary.test.ts lists it in NODE_PKGS).
//
// The version in package.json is the worker version (runner/version.ts reads
// it), bumped together with @markbase/cli.

export * from "./detect-claude";
export * from "./claude-code";
export * from "./mcp-install";
export * from "./audit-hooks";

export {
  awaitDeviceAuth,
  DeviceAuthCanceledError,
  type DeviceAuthOptions,
} from "./device-auth";
