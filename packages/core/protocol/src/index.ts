// The isomorphic half of the old `core`: data access and pure logic that runs in
// a browser, on a server, and in a daemon alike.
//
// Anything that opens a file, spawns a process or reads the home directory lives
// in @markbase/node, @markbase/vault or @markbase/runner instead. This package
// has no node dependency at all, and test/package-boundary.test.ts fails if one
// becomes reachable — the browser imports this entry, and a bundler's
// tree-shaking is not a safety guarantee.
//
// Two things that used to be exported here are gone on purpose: the Supabase
// CRDT store now lives in @markbase/docs (it implements that package's own
// DocStore/DocPubSub), and VaultSyncManager lives in @markbase/vault. Both
// imported @markbase/docs, so re-exporting them here would make protocol depend
// on docs while docs depends on protocol — the cycle this split exists to break.

export * from "./types";
export * from "./tickets";
export * from "./todos";
export * from "./skills";
export * from "./features";
export * from "./version";
export * from "./vault";
export * from "./jobs";
export * from "./project-docs";
export * from "./plans";
export * from "./agent-sessions";

// Pure path strings — no imports at all. Shared by the browser (the vault tree),
// the vault daemon and docs alike, which is why it is here rather than in either
// of them: node-only vault could not serve the browser, and docs is a feature.
export {
  normalizePath,
  folderOf,
  filePathIn,
  listFolders,
  buildFolderTree,
  filesUnder,
  renameFolder,
  moveFolder,
  rebaseToVaultRoot,
  type Move,
  type FolderNode,
} from "./folders";

// The disk surfaces, declared once here so the vault daemon and the doc engine
// cannot drift apart — and so neither has to import the other to agree.
export type { VaultFs, VaultSyncFs, VaultBaseStore } from "./storage";

export { configureSupabase } from "./supabase";
export {
  listWorkerRepos,
  requestRepoRescan,
  type RepoStatus,
  type WorkerRepo,
} from "./worker-repos";
export { planReconcile, type ReconcilePlan, type VaultDocRef } from "./vault-reconcile";
