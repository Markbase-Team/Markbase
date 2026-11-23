import type { McpApp } from "../../mcp-http";
import { EMBED_SESSION_TOOL, FRAME_APP_CSS, FRAME_APP_JS } from "./app-app";
import { appPage } from "./page";

// The document card: a document, drawn in the conversation.
//
// Shown when an agent reads a document or has just created one, so the person
// sees the result — the title, who they are on it, and the text as it reads —
// where they asked for it, with a button that opens it in Markbase. It shows
// what the tool already answered and asks the server for nothing more.

export const DOC_APP_URI = "ui://markbase/doc";

/** The tools whose answer carries a whole document (`{ doc: { id, title, content, … } }`). */
export const DOC_APP_TOOLS = ["docs_readDoc", "docs_createDoc"] as const;

const CSS = `
.head { padding-bottom: 12px; border-bottom: 1px solid var(--mb-line); }
.meta { margin-top: 6px; }
.doc { position: relative; margin-top: 12px; }
.doc.clamped { max-height: 360px; overflow: hidden; }
.doc.clamped::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 72px; pointer-events: none;
  background: linear-gradient(transparent, var(--color-background-primary, light-dark(#ffffff, #1f1f1e)));
}
.more { margin-top: 8px; }
.doc > :first-child { margin-top: 0; }
.doc h1 { font-size: 20px; } .doc h2 { font-size: 17px; } .doc h3 { font-size: 15px; }
.doc h1, .doc h2, .doc h3, .doc h4, .doc h5, .doc h6 { line-height: 1.3; margin: 18px 0 6px; }
.doc p, .doc ul, .doc ol, .doc blockquote, .doc pre, .doc table { margin: 8px 0; }
.doc ul, .doc ol { padding-left: 22px; }
.doc li.task { list-style: none; margin-left: -22px; display: flex; gap: 8px; align-items: baseline; }
.doc .box { width: 12px; height: 12px; flex: none; border: 1px solid var(--mb-muted); border-radius: 3px; transform: translateY(2px); }
.doc .box.done { background: var(--mb-fg); border-color: var(--mb-fg); }
.doc blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid var(--mb-line); color: var(--mb-muted); }
.doc code { font-family: var(--font-mono, ui-monospace, Menlo, monospace); font-size: 12.5px; background: var(--mb-surface); border-radius: 4px; padding: 1px 4px; }
.doc pre { background: var(--mb-surface); border-radius: var(--mb-radius); padding: 10px 12px; overflow-x: auto; }
.doc pre code { background: none; padding: 0; }
.doc hr { border: 0; border-top: 1px solid var(--mb-line); margin: 16px 0; }
.doc table { border-collapse: collapse; display: block; overflow-x: auto; }
.doc th, .doc td { border: 1px solid var(--mb-line); padding: 4px 8px; text-align: left; }
`;

const SCRIPT = String.raw`
var ROLES = { owner: "Owner", editor: "Can edit", commenter: "Can comment", viewer: "Can view" };

function when(iso) {
  var date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function draw(result) {
  var root = document.getElementById("root");
  var doc = result.data && result.data.doc;
  if (result.error || !doc || typeof doc.id !== "string") {
    root.innerHTML = '<p class="state error">' + escapeHtml(result.error || "There is no document in this answer.") + "</p>";
    return;
  }
  var chips = "";
  var role = ROLES[result.data.capability];
  if (role) chips += '<span class="chip">' + role + "</span>";
  if (typeof doc.version === "number") chips += '<span class="chip">Version ' + doc.version + "</span>";
  var updated = when(doc.updated_at);
  if (updated) chips += '<span class="small muted">Updated ' + escapeHtml(updated) + "</span>";

  root.innerHTML =
    '<div class="head">' +
      '<div class="row spread">' +
        '<h1 class="title">' + escapeHtml(doc.title || "Untitled") + "</h1>" +
        '<div class="row">' +
          (CONFIG.instance ? '<button id="full">' + CONFIG.icons.maximize + "Open full page</button>" : "") +
          '<button class="primary" id="open">' + CONFIG.icons.externalLink + "Open in Markbase</button>" +
        "</div>" +
      "</div>" +
      (chips ? '<div class="row meta">' + chips + "</div>" : "") +
    "</div>" +
    '<div class="doc" id="doc">' + (String(doc.content || "").trim() ? renderMarkdown(doc.content) : '<p class="muted">This document is empty.</p>') + "</div>" +
    '<div class="more" id="more" hidden><button id="toggle">' + CONFIG.icons.chevronDown + "<span>Show more</span></button></div>";

  /* Full page: the real app, at this document, in the panel beside the conversation (./app-app). */
  var full = document.getElementById("full");
  if (full) full.addEventListener("click", function () {
    document.body.classList.add("framing");
    root.innerHTML = '<div class="stage" id="stage"></div>';
    frameApp(document.getElementById("stage"), doc.id, function (message) {
      document.body.classList.remove("framing");
      draw({ error: message });
    });
  });

  document.getElementById("open").addEventListener("click", function () {
    mb.openLink(CONFIG.docUrlPrefix + encodeURIComponent(doc.id)).catch(function () {});
  });

  /* A long document is cut short, with a way to see the rest. */
  var body = document.getElementById("doc");
  if (body.scrollHeight > 400) {
    body.classList.add("clamped");
    document.getElementById("more").hidden = false;
    document.getElementById("toggle").addEventListener("click", function () {
      var clamped = body.classList.toggle("clamped");
      this.querySelector("span").textContent = clamped ? "Show more" : "Show less";
    });
  }
}

mb.on("ui/notifications/tool-result", function (params) { draw(readToolResult(params)); });
mb.on("ui/notifications/tool-cancelled", function () { draw({ error: "The request was cancelled." }); });
mb.start({ name: "markbase-doc", version: "1.0.0", protocol: CONFIG.protocol });
`;

/**
 * The page. `docUrlPrefix` + a document's id is where that document opens on
 * this instance. With `instance` (the embed experiment switched on), the card
 * also offers "Open full page": the real app at this document, framed.
 */
export function docAppHtml(docUrlPrefix: string, instance?: string): string {
  return appPage({
    title: "Markbase document",
    css: CSS + (instance ? FRAME_APP_CSS + FRAMING_CSS : ""),
    body: '<div id="root"><p class="state">Loading the document…</p></div>',
    config: instance ? { docUrlPrefix, instance, sessionTool: EMBED_SESSION_TOOL } : { docUrlPrefix },
    script: (instance ? FRAME_APP_JS : "") + SCRIPT,
  });
}

/** Once the card frames the app, the frame is the whole card. */
const FRAMING_CSS = `
body.framing { padding: 0; height: 100vh; display: flex; flex-direction: column; }
body.framing #root { flex: 1; min-height: 0; display: flex; flex-direction: column; }
`;

/**
 * The document card for an instance. The address is the shell's to give: a
 * feature does not know where the app that shows its documents lives.
 */
export function docApp(docUrlPrefix: string, instance?: string): McpApp {
  return {
    uri: DOC_APP_URI,
    name: "Markbase document",
    description: "A Markbase document, shown as it reads, with a button that opens it in Markbase.",
    tools: DOC_APP_TOOLS,
    ...(instance ? { cardOnlyTools: [EMBED_SESSION_TOOL], frameDomains: [instance] } : {}),
    html: docAppHtml(docUrlPrefix, instance),
  };
}
