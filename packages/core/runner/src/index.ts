// Claiming and executing work: the ticket worker loop, and discovering which
// repos and agent sessions this machine can offer.
//
// Node-only, and the top of the dependency graph — it draws on @markbase/protocol
// (jobs, tickets, connection identity), @markbase/node (API keys, the Claude
// probe, repo state) and @markbase/vault (the mirror). Nothing imports it back.
//
// Both the CLI and the desktop app start it. Having it in its own package is
// what made the desktop a host change rather than another copy of the loop; the
// worker lock (@markbase/vault) is what lets both hosts be installed on one
// machine without both claiming the owner's jobs.

export * from "./discover-repos";
export * from "./run-ticket-worker";
export * from "./version";
