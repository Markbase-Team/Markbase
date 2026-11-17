import { assetsHandler } from "./assets";
import { docCrdtChangesHandler, docCrdtHandler } from "./crdt";
import { docMembershipHandler, docsHandler, documentHandler } from "./documents";
import { docContentHandler, docEditsHandler, docRestoreHandler } from "./editing";
import { docAtHandler, docDiffHandler, docHistoryHandler, docsSearchHandler } from "./history";
import { docCommentHandler, docCommentsHandler, docLinkHandler, docLinksHandler } from "./sharing";
import { docPublishHandler, docTabHandler, docTabsHandler } from "./tabs";
import { vaultConvertHandler, vaultHandler, vaultsHandler } from "./vaults";

// Which code answers each endpoint in the registry (logic/endpoints.ts).
//
// The registry says what an endpoint IS — its method and path, who may call it,
// what it takes. This says what RUNS. Between them they are the whole of an
// endpoint, and the web app's route files are generated from the pair
// (apps/web/scripts/gen-api-routes.ts): a route exists because an entry and a
// handler do, so there is no third place to keep in step, and no way to serve a
// route the registry — and so the MCP server, the skill and `markbase api` —
// has not heard of.
//
// To add an endpoint: an entry in DOC_ENDPOINTS, a line here, then
// `npm run gen:api -w @markbase/web`. A test fails if either half is missing.

/** A path's `:name` parameters, by name. */
export interface RouteParams {
  [name: string]: string;
}

export type EndpointHandler = (req: Request, params: RouteParams) => Promise<Response>;

export const ENDPOINT_HANDLERS: { [endpointId: string]: EndpointHandler } = {
  docs_listDocs: (req) => docsHandler.GET(req),
  docs_createDoc: (req) => docsHandler.POST(req),
  docs_searchDocs: (req) => docsSearchHandler(req),
  docs_readDoc: (req, p) => documentHandler.GET(req, p.id),
  docs_renameDoc: (req, p) => documentHandler.PATCH(req, p.id),
  docs_deleteDoc: (req, p) => documentHandler.DELETE(req, p.id),
  docs_editDoc: (req, p) => docEditsHandler(req, p.id),
  docs_replaceContent: (req, p) => docContentHandler(req, p.id),
  docs_restoreDoc: (req, p) => docRestoreHandler(req, p.id),
  docs_history: (req, p) => docHistoryHandler(req, p.id),
  docs_docAt: (req, p) => docAtHandler(req, p.id),
  docs_docDiff: (req, p) => docDiffHandler(req, p.id),
  docs_listComments: (req, p) => docCommentsHandler.GET(req, p.id),
  docs_addComment: (req, p) => docCommentsHandler.POST(req, p.id),
  docs_resolveComment: (req, p) => docCommentHandler.PATCH(req, p.id, p.cid),
  docs_listLinks: (req, p) => docLinksHandler.GET(req, p.id),
  docs_createLink: (req, p) => docLinksHandler.POST(req, p.id),
  docs_deleteLink: (req, p) => docLinkHandler.DELETE(req, p.id, p.linkId),
  docs_setMemberPath: (req, p) => docMembershipHandler.PATCH(req, p.id),
  docs_leaveShare: (req, p) => docMembershipHandler.DELETE(req, p.id),
  docs_publishStatus: (req, p) => docPublishHandler.GET(req, p.id),
  docs_publish: (req, p) => docPublishHandler.POST(req, p.id),
  docs_unpublish: (req, p) => docPublishHandler.DELETE(req, p.id),
  docs_listTabs: (req, p) => docTabsHandler.GET(req, p.id),
  docs_addTab: (req, p) => docTabsHandler.POST(req, p.id),
  docs_reorderTabs: (req, p) => docTabsHandler.PATCH(req, p.id),
  docs_deleteTab: (req, p) => docTabHandler.DELETE(req, p.id, p.tabId),
  docs_readCrdt: (req, p) => docCrdtHandler.GET(req, p.id),
  docs_writeCrdt: (req, p) => docCrdtHandler.POST(req, p.id),
  docs_crdtChanges: (req) => docCrdtChangesHandler.GET(req),
  docs_listVaults: (req) => vaultsHandler.GET(req),
  docs_createVault: (req) => vaultsHandler.POST(req),
  docs_readVault: (req, p) => vaultHandler.GET(req, p.id),
  docs_renameVault: (req, p) => vaultHandler.PATCH(req, p.id),
  docs_deleteVault: (req, p) => vaultHandler.DELETE(req, p.id),
  docs_convertFolderToVault: (req) => vaultConvertHandler(req),
  docs_listAssets: (req) => assetsHandler.GET(req),
  docs_uploadAsset: (req) => assetsHandler.POST(req),
};

/**
 * The route handler for one endpoint, in the shape a Next route file exports:
 * it waits for the path's parameters and hands them to the endpoint's handler.
 * Throws at load for an id with no handler, so a generated route that names
 * one cannot be deployed.
 */
export function endpointRoute(
  endpointId: string
): (req: Request, ctx: { params: Promise<RouteParams> }) => Promise<Response> {
  const handler = ENDPOINT_HANDLERS[endpointId];
  if (!handler) throw new Error(`No handler for endpoint ${endpointId}`);
  return async (req, ctx) => handler(req, await ctx.params);
}
