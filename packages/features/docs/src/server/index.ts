// Server data layer for @markbase/docs — Supabase-backed, scoped to the `docs`
// schema. Pure capability logic (auth.ts) is testable on its own; the rest wraps
// the tables. Imported by the web app's /api/v1/docs route handlers.

export {
  capabilityFor,
  atLeast,
  type Capability,
  type Actor,
} from "./auth";
export {
  createDocument,
  getDocument,
  listDocumentsForUser,
  listSharedDocumentsForUser,
  searchDocuments,
  renameDocument,
  setDocumentPath,
  pathFollowingTitle,
  mirrorDocContent,
  deleteDocument,
  restoreDocument,
  listTrashedInVault,
  getTrashedDocument,
  deleteDocumentGroup,
  listTabs,
  createTab,
  reorderTabs,
  type DocumentRow,
  type DocumentListRow,
  type SharedDocumentListRow,
  type TabRow,
  type DocSearchHit,
} from "./documents";
export {
  listVaultsForUser,
  getVault,
  userOwnsVault,
  createVault,
  renameVault,
  deleteVault,
  ensureDefaultVault,
  convertFolderToVault,
  type VaultRow,
} from "./vaults";
export { seedWelcomeDoc, WELCOME_DOC_PATH } from "./welcome";
export { getUserDisplay } from "./users";
export {
  publishDocument,
  publishVersions,
  type PublishVersions,
  unpublishDocument,
  getPublishedDoc,
  getPublishedTabs,
  listPublishedDocs,
} from "./publish";
export {
  getMemberCapability,
  getMembership,
  listMembershipsForUser,
  setMemberPath,
  removeMember,
  grantMember,
  listMembers,
  type MemberRow,
  type Membership,
} from "./members";
export {
  createLink,
  listLinks,
  getLinkByToken,
  revokeLink,
  type LinkMode,
  type LinkRow,
} from "./links";
export {
  listComments,
  createComment,
  setCommentResolved,
  type CommentRow,
} from "./comments";
export {
  receiveSteps,
  setDocContent,
  listRevisions,
  contentAtVersion,
  docJsonAtVersion,
  revisionDiff,
  restoreVersion,
  type ReceiveResult,
  type RevisionRow,
} from "./steps";
export type { DiffSegment } from "../logic/diff";
export {
  listAssets,
  getAssetByPath,
  putAsset,
  signAssetUrl,
  downloadAsset,
  deleteAsset,
  orphanAssetObjects,
  sweepOrphanAssets,
  ORPHAN_GRACE_MS,
  hashBytes,
  objectKey,
  ASSET_BUCKET,
  ASSET_URL_TTL_SECONDS,
  type AssetRow,
} from "./assets";
export { ownerDisplayName } from "./owner-name";

// Who is asking, as an author. Takes what the handler layer read off the
// request (`Credentials`) — never the request: resolveActor turns the caller
// the gate attached into an actor; the two requireDoc* guards turn that into a
// capability on one document, or admit a share-link guest where the gate
// attached nobody.
export type { Credentials, ResolvedActor, DocAuth } from "./docs-auth";
export {
  resolveActor,
  requireDocEndpoint,
  requireDocCapability,
} from "./docs-auth";
export type { EditResult } from "./doc-crdt";
export { readDocCrdt, editDocCrdt } from "./doc-crdt";
export {
  loadCrdtSnapshot,
  saveCrdtSnapshot,
  broadcastCrdt,
  listCrdtChanges,
  type CrdtSnapshot,
  type CrdtSaveResult,
  type CrdtChanges,
} from "./crdt-store";
export type { Revived } from "./revive-doc";
export { reviveForFile } from "./revive-doc";
export { dispatchMentions } from "./dispatch-mentions";
