// The local vault: the watcher, the lock, materialising files, and the sync
// engine that keeps a folder and the cloud CRDT in step.
//
// Node-only, and the half of the old core that actually justified the split —
// fs.watch, node:fs and the home directory all live behind here. It depends on
// @markbase/docs for the CRDT itself and on @markbase/protocol for data access;
// nothing depends on it in return, which is what makes the graph acyclic.

export {
  acquireVaultLock,
  acquireWorkerLock,
  VaultLockedError,
  type VaultLock,
  type VaultLockInfo,
} from "./vault-lock";
export {
  readVaultIndex,
  writeVaultIndex,
  docIdForFile,
  vaultIndexPath,
  type VaultIndex,
  type VaultIndexEntry,
} from "./vault-index";
export {
  readMountedVaults,
  readUnmountedVaults,
  // No writeMountedVaults: replacing the whole list from a stale read is how a
  // concurrent mount got erased. Every writer goes through the mutator instead.
  updateMountedVaults,
  unmountVault,
  findMountedVaultDir,
  addMountedVault,
  removeMountedVault,
  adoptLegacyVaults,
  mountedByAccount,
  mountsForAccount,
  setMountedVaultOwner,
  readSavedInstance,
  saveInstance,
  VAULT_REGISTRY_PATH,
  type MountedVault,
  type SavedInstance,
} from "./vault-registry";
export {
  VaultNotOursError,
  VaultGoneError,
  confirmMountAccount,
  recordMountOwner,
  recordedOwnerOf,
  resolveKeyOwner,
  sharedFolderHasDocs,
  vaultOwnerPerApi,
  type ConfirmMountDeps,
  type VaultOwnerAnswer,
} from "./vault-account";
export {
  startVaultSync,
  assignPaths,
  mirrorable,
  EMPTY_LISTING_GUARD_AT,
  type VaultSyncOptions,
  type DocSummary,
  type DocCapability,
  type ForeignVault,
  type VaultSyncProgress,
  type LocalFork,
  type ForkControl,
  type SharedVaultHost,
} from "./vault-sync-run";
export {
  planAssetSync,
  listDiskAssets,
  hashFile,
  isAssetPath,
  mimeForPath,
  writeAsset,
  readAsset,
  type AssetPlan,
  type CloudAsset,
  type DiskAsset,
} from "./vault-assets";
export {
  NodeVaultFs,
  NodeVaultBaseStore,
  listMarkdown,
  isMarkdownPath,
  writeVaultMarker,
  readVaultMarker,
  readVaultMarkerInfo,
  vaultRootIntact,
} from "./vault-fs";
export {
  VAULT_MARKER,
  markerPathFor,
  pathsOverlap,
  nestedVaultFor,
  markerDirOf,
  ignoredByWatcher,
  checkMount,
  type VaultMarker,
  type MountVerdict,
  type MountedVaultRef,
} from "./vault-boundary";
export {
  IGNORE_FILE,
  DEFAULT_IGNORE,
  parseIgnore,
  emptyIgnore,
  loadVaultIgnore,
  type VaultIgnore,
} from "./vault-ignore";
export {
  markbaseHome,
  legacyMarkbaseHome,
  registryPath,
  locksDir,
  baseStoreDir,
  migrateHome,
} from "./markbase-home";
export {
  VaultSyncManager,
  type VaultDocRef,
  type AdoptFile,
} from "./vault-sync-manager";
// What a file looks like to the vault, and the adapter that makes a CRDT
// document one. A host wiring its own container supplies an OpenSyncedFile.
export type { SyncedFile, OpenSyncedFile, AgentCredit } from "./synced-file";
// Declared in @markbase/protocol (one declaration, no cycle); re-exported here
// because every host that wires a vault imports them alongside the vault itself.
export type { VaultFs, VaultSyncFs, VaultBaseStore } from "@markbase/protocol/storage";
export { docsSyncedFiles } from "./docs-synced-file";

export * from "./mirror-format";
export * from "./mirror";
// What agents read and write in mounted vaults, as their own hooks report it.
export {
  auditDir,
  readsLedgerPath,
  writesLedgerPath,
  findVaultFile,
  shellReads,
  recordReads,
  snapshotWrites,
  recordWrites,
  undoEdits,
  readReadEvents,
  readWriteEvents,
  countReads,
  countWrites,
  agentCredit,
  type ReadEvent,
  type WriteEvent,
  type WriteBaseline,
  type VaultFile,
  type ReadCount,
  type WriteCount,
} from "./agent-audit";
export {
  parseHookPayload,
  detectAgent,
  patchFiles,
  readHookCall,
  type Json,
  type HookCall,
  type HookEdit,
  type HookWrite,
} from "./agent-hook";
export { textChanges, changeTotals, type TextChange } from "./text-changes";
