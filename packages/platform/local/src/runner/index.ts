// Claiming and executing work: the ticket worker loop, and discovering which
// repos and agent sessions this machine can offer.
//
// Node-only, and the top of the dependency graph — it draws on @markbase/shared
// (jobs, tickets, connection identity), the machine-side files beside it in
// @markbase/local (the Claude probe and session), @markbase/node (repo state)
// and @markbase/local/vault (the mirror). Nothing imports it back.
//
// Both the CLI and the desktop app start it. Having it apart from both hosts is
// what made the desktop a host change rather than another copy of the loop; the
// worker lock (@markbase/local/vault) is what lets both hosts be installed on one
// machine without both claiming the owner's jobs.

export * from "./discover-repos";
export * from "./run-ticket-worker";
export * from "./version";
