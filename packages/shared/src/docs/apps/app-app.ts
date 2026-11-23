import type { AgentTool } from "../../endpoint-tools";
import type { McpApp } from "../../mcp-http";
import { DOC_VIEW_CSS, DOC_VIEW_JS } from "./doc-view";
import { EMBED_SESSION_TOOL, FRAME_APP_CSS, FRAME_APP_JS } from "./frame";
import { appPage } from "./page";

// The app card: the real Markbase app, full page, inside the conversation —
// the editor, comments, history and live co-editing, signed in as the person
// whose connector it is. EXPERIMENT (docs/embed-proof.md): offered only while
// the embed is switched on.
//
// It draws the document first, from docs_readDoc (./doc-view), so it shows in
// any host. The real app is laid over it and shown only once it loads
// (./frame): Claude blocks markbase.so in a connector's card unless it has
// allowed the site, and says nothing to the card when it does. Signing the
// frame in takes a one-minute hand-off from a card-only tool (me_embedSession),
// so the address never reaches the model.

export const APP_APP_URI = "ui://markbase/app";
export const OPEN_APP_TOOL = "me_openApp";
export { EMBED_SESSION_TOOL, FRAME_APP_CSS, FRAME_APP_JS } from "./frame";

/** The two tools the app card needs. Served by the web app under /me/embed while the embed is on. */
export const EMBED_TOOLS: readonly AgentTool[] = [
  {
    name: OPEN_APP_TOOL,
    description:
      "Open the Markbase app full page beside the conversation, at one document or at the documents list — " +
      "When the person wants to see, edit or work in their document themselves (check a box, rewrite a passage, comment), or asks to open Markbase.",
    method: "GET",
    path: "/me/embed/app",
    params: [{ name: "doc", type: "string", description: "The document to open; omitted, the documents list." }],
    readOnly: true,
    destructive: false,
  },
  {
    name: EMBED_SESSION_TOOL,
    description: "A one-minute sign-in for the app card's frame. For the card only.",
    method: "POST",
    path: "/me/embed/session",
    params: [{ name: "doc", type: "string" }],
    readOnly: false,
    destructive: false,
  },
];

const SCRIPT = String.raw`
/*
 * me_openApp answers with the document's id. The card reads the document
 * through the host (docs_readDoc) and draws it straight away, so there is
 * something to read whatever the host allows; the real app is laid over it
 * and shows only if it loads (./frame).
 */
mb.on("ui/notifications/tool-result", function (params) {
  var answer = readToolResult(params);
  var docId = answer.data && typeof answer.data.doc_id === "string" ? answer.data.doc_id : null;
  if (answer.error || !docId) {
    draw({ error: answer.error || "There is no document to open." });
    return;
  }
  mb.callTool("docs_readDoc", { id: docId }).then(function (read) {
    draw(read);
    overlayApp(docId);
  }, function () {
    draw({ error: "The assistant's app would not let this card read the document." });
  });
});
mb.start({ name: "markbase-app", version: "0.2.0", protocol: CONFIG.protocol });
`;

/** The page, for the instance at `instance` (an origin, no trailing slash). */
export function appAppHtml(instance: string): string {
  return appPage({
    title: "Markbase",
    css: DOC_VIEW_CSS + FRAME_APP_CSS,
    body: '<div id="root"><p class="state">Opening the document…</p></div>',
    // "Open in Markbase" goes through the instance's /open page: the desktop app first, the website when it is not there.
    config: { instance, sessionTool: EMBED_SESSION_TOOL, docUrlPrefix: `${instance}/open?doc=` },
    script: FRAME_APP_JS + DOC_VIEW_JS + SCRIPT,
  });
}

/**
 * The app card for an instance. `instance` is the shell's to give: it is the
 * only origin the card may frame. `domain` is the card's fixed sandbox host
 * (see claudeCardHost in the web app), so the instance can name exactly that
 * host in frame-ancestors rather than every connector's.
 */
export function appApp(instance: string, domain?: string): McpApp {
  return {
    ...(domain ? { domain } : {}),
    uri: APP_APP_URI,
    name: "Markbase app",
    description: "The real Markbase app, full page beside the conversation.",
    tools: [OPEN_APP_TOOL],
    cardOnlyTools: [EMBED_SESSION_TOOL],
    frameDomains: [instance],
    prefersBorder: false,
    html: appAppHtml(instance),
  };
}
