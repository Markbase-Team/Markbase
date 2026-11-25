// @markbase/shared/docs — the collaborative-doc engine. Framework-agnostic and
// headless: the shared ProseMirror schema, markdown <-> doc, the step transform
// core, and comment anchoring. Imported by the web app's editor (client) and the
// edit API / authority (server) so both sides agree on schema, steps, and
// markdown.

// The Supabase Realtime DocPubSub. It implements the interface transport.ts
// defines and is handed its client, so it names neither the browser's nor the
// server's.
export {
  SupabaseDocPubSub,
  LEGACY_PUBLIC_RELAY,
  docTopic,
  legacyDocTopic,
  bytesToBase64,
  base64ToBytes,
} from "./crdt-supabase";
export {
  retryingDb,
  isTransientDbError,
  type DbError,
  type DbResult,
} from "./db-retry";
// The API-side transport every client uses for snapshots since stage 2, and
// the merge the server performs on each save.
export {
  ApiCrdtTransport,
  CrdtChangesFeed,
  bearerCrdtRequest,
  CRDT_POLL_MS,
  type CrdtRequest,
  type ApiCrdtTransportOptions,
} from "./crdt-api";
export { mergeSnapshot, type MergedSnapshot } from "./crdt-merge";

export { docSchema } from "./schema";
export { docExtensions, Frontmatter, SelectAllShortcut } from "./extensions";
export {
  markdownToDoc,
  docToMarkdown,
  docJsonToMarkdown,
  emptyDoc,
  docJsonIsValid,
  deriveTitle,
  isUntitled,
  leadingH1,
  retitleLeadingH1,
  splitFrontmatter,
} from "./markdown";
export { docFileSlug, combineTabMarkdown } from "./download";
export { docExcerpt, EXCERPT_LENGTH } from "./excerpt";
export { applySteps, mapPositionThroughSteps } from "./steps";
export { resolveQuoteToRange, remapAnchor, docText, posToTextOffset, textOffsetToPos } from "./anchors";
export { mapPositionThroughEdit, mapSelectionThroughEdit } from "./selection";
export {
  anchoredEditToSteps,
  applyAnchoredEdit,
  type AnchoredEdit,
  type AnchoredEditPath,
} from "./agent";
export { diffCounts, diffSegments, type DiffSegment } from "./diff";
export { docReplaceSteps } from "./restore";
export {
  DOC_ENDPOINTS,
  ACCOUNT_ENDPOINTS,
  ALL_ENDPOINTS,
  AGENT_ENDPOINTS,
  docEndpoint,
  type DocEndpoint,
  type HttpMethod,
  type EndpointScope,
  type EndpointParam,
  type ParamType,
} from "./endpoints";
export { renderEndpointsDoc } from "./skill-doc";
export {
  AGENT_TOOLS_PATH,
  agentTools,
  parseAgentTools,
  toolInputSchema,
  type AgentTool,
  type ToolInputSchema,
} from "./agent-tools";
export type { Author, Anchor, DocJSON, StepJSON, JSONValue } from "./types";
export { accountOf } from "./types";
export * from "./mentions";
export {
  createDoc,
  getMarkdown,
  setMarkdown,
  observeMarkdown,
  applyFastDiff,
  derivedDoc,
  encodeUpdate,
  applyUpdate,
  threeWayMerge,
  type Origin,
  type MergeResult,
} from "./crdt";
export {
  VaultDoc,
  VaultFolder,
  type FlushResult,
  type ApplyResult,
  type VaultFs,
} from "./vault";
export { createAnchor, resolveAnchor, isOrphaned, type CrdtAnchor } from "./anchor";
export { createUndoManager } from "./undo";
export {
  snapshot,
  restore,
  stateVector,
  diffSince,
  mergeUpdates,
  applyRemote,
} from "./sync";
export { SyncSession, type DocStore, type DocPubSub } from "./transport";
export {
  VaultSync,
  type AgentCredit,
  type VaultSyncFs,
  type VaultBaseStore,
  type VaultSyncOpenOptions,
} from "./vault-sync";
export { EditorBinding, EDITOR_ORIGIN, type EditorBridge } from "./editor-binding";
export { VersionTracker } from "./version-tracker";
export { openEditorDoc, type OpenedDoc } from "./editor-doc";
export {
  addComment,
  addReply,
  listCommentThreads,
  resolveComment,
  deleteComment,
  commentRanges,
  offsetForQuote,
  commentHighlightRanges,
  watchComments,
  type CommentView,
} from "./doc-comments";
export {
  appendVersion,
  checkpoint,
  listVersions,
  versionContent,
  versionCount,
  versionDiff,
  shouldCheckpoint,
  restoreVersionContent,
  restoreVersion,
  KEYFRAME_EVERY,
  agentLabel,
  versionCreditText,
  versionContents,
  type VersionMeta,
  type VersionCredit,
} from "./versions";
export {
  addAgentReads,
  mergeAgentReads,
  listAgentReads,
  watchAgentReads,
  lineCredit,
  writerText,
  readerText,
  docAnalytics,
  type DocAnalyticsReport,
  type AgentReadReport,
  type WriterShareReport,
  type CreditedRangeReport,
  type AgentReadTally,
  type LineWriter,
  type CreditedRange,
  type WriterShare,
  type LineCredit,
} from "./analytics";
export {
  imageRefs,
  rewriteImageRefs,
  isExternalRef,
  assetPathFor,
  MediaRegistry,
  selectOrphans,
  type ImageRef,
  type StoredObject,
  type AssetLink,
  type MarkdownLens,
} from "./media";
export { chooseRevival, type RevivalCandidate, type Revival } from "./revive";
export { pinnedVersion, pinVersion, publishedMarkdown, behindPublished } from "./publish-pin";
export {
  CORE_FIELDS,
  DOC_STATUSES,
  AUDIENCES,
  docStatus,
  readCoreFields,
  lastMeaningfulChange,
  meaningOf,
  trustOf,
  timestampMs,
  confirmsOwnChange,
  type CoreField,
  type CoreFields,
  type DocStatus,
  type Audience,
  type ActorRef,
  type Confirmation,
  type FieldWarning,
  type Trust,
  type DocStatusReport,
  type VersionText,
  type VersionWriter,
  type MeaningfulChange,
} from "./doc-status";
