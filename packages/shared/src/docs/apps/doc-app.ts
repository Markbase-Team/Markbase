import type { McpApp } from "../../mcp-http";
import { DOC_VIEW_CSS, DOC_VIEW_JS } from "./doc-view";
import { EMBED_SESSION_TOOL, FRAME_APP_CSS, FRAME_APP_JS } from "./frame";
import { appPage } from "./page";

// The document card: a document, drawn in the conversation.
//
// Shown when an agent reads a document or has just created one, so the person
// sees the result — the title, who they are on it, and the text as it reads —
// where they asked for it, with "Open full page" and "Open in Markbase" (see
// ./doc-view). It draws what the tool already answered.

export const DOC_APP_URI = "ui://markbase/doc";

/** The tools whose answer carries a whole document (`{ doc: { id, title, content, … } }`). */
export const DOC_APP_TOOLS = ["docs_readDoc", "docs_createDoc"] as const;

const SCRIPT = String.raw`
mb.on("ui/notifications/tool-result", function (params) { draw(readToolResult(params)); });
mb.on("ui/notifications/tool-cancelled", function () { draw({ error: "The request was cancelled." }); });
mb.start({ name: "markbase-doc", version: "1.0.0", protocol: CONFIG.protocol });
`;

/**
 * The page. `docUrlPrefix` + a document's id is where that document opens on
 * this instance. With `instance` (the embed switched on), full page also lays
 * the real app over the document when the host lets it load (./frame).
 */
export function docAppHtml(docUrlPrefix: string, instance?: string): string {
  return appPage({
    title: "Markbase document",
    css: DOC_VIEW_CSS + (instance ? FRAME_APP_CSS : ""),
    body: '<div id="root"><p class="state">Loading the document…</p></div>',
    config: instance ? { docUrlPrefix, instance, sessionTool: EMBED_SESSION_TOOL } : { docUrlPrefix },
    script: (instance ? FRAME_APP_JS : "") + DOC_VIEW_JS + SCRIPT,
  });
}

/**
 * The document card for an instance. The address is the shell's to give: a
 * feature does not know where the app that shows its documents lives.
 */
export function docApp(docUrlPrefix: string, instance?: string, domain?: string): McpApp {
  return {
    ...(instance && domain ? { domain } : {}),
    uri: DOC_APP_URI,
    name: "Markbase document",
    description: "A Markbase document, shown as it reads, with Open full page and Open in Markbase.",
    tools: DOC_APP_TOOLS,
    ...(instance ? { cardOnlyTools: [EMBED_SESSION_TOOL], frameDomains: [instance] } : {}),
    html: docAppHtml(docUrlPrefix, instance),
  };
}
