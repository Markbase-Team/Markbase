// Flows shared by every client: the steps of mounting a vault, signing in and
// reconciling a folder, written once and asked of an Operator.
//
// Isomorphic on purpose — the interface and the unattended implementation carry
// no filesystem, so a browser can hold the types too. Implementations that need
// Node (a terminal prompt) or Electron (a dialog) live with their hosts.

export * from "./operator";
