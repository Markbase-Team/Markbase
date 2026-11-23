// @markbase/shared (packages/shared), formerly @markbase/protocol: shapes,
// contracts and pure logic that run everywhere, in a browser, on a server and
// in a daemon alike. It sits below packages/platform and packages/features and
// imports neither. Nothing here queries the
// database: the Supabase client and every query live in @markbase/server
// (src/supabase.ts and src/db/), which imports the shapes from here.
//
// Anything that opens a file, spawns a process or reads the home directory lives
// in @markbase/server (the web server) or @markbase/local (the user's machine)
// instead. This package has no node dependency at all, and test/package-boundary.test.ts fails if one
// becomes reachable — the browser imports this entry, and a bundler's
// tree-shaking is not a safety guarantee.
//
// The document engine (schema, markdown, CRDT, sync transport) is the folder
// src/docs, imported as @markbase/shared/docs. It is deliberately not
// re-exported here: it pulls in ProseMirror and Yjs, which most importers of
// this barrel do not need.

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

export { type RepoStatus, type WorkerRepo } from "./worker-repos";
export { planReconcile, type ReconcilePlan, type VaultDocRef } from "./vault-reconcile";
