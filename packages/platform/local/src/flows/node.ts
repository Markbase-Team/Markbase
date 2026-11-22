// The flows that need a machine: a filesystem to mount into, a terminal to ask
// at. Imported by the CLI and the Electron main process, never by the browser.
//
// "." stays the interface and the unattended implementation — the parts with no
// machine behind them. test/package-boundary.test.ts pins that split, so adding
// an export here rather than there is a decision, not an accident.

export * from "./can-open-browser";
export * from "./mount-vault";
export * from "./reconcile-vaults";
export * from "./sign-in";
export * from "./terminal-operator";
// Supervising daemons needs no filesystem of its own, but nothing in a browser
// runs daemons — same reason terminal-operator is here rather than in ".".
export * from "./vault-supervisor";
