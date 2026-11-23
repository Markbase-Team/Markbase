import type { AgentTool } from "../../endpoint-tools";
import type { McpApp } from "../../mcp-http";
import { appPage } from "./page";

// The app card: the real Markbase app, full page, inside the conversation —
// the editor, comments, history and live co-editing, signed in as the person
// whose connector it is. EXPERIMENT (docs/embed-proof.md): offered only while
// the embed is switched on.
//
// It frames the app; it does not draw anything of its own. The frame has no
// session to begin with (the person's markbase.so cookies belong to another
// site and are not sent into it), so the card first asks, through the host and
// with the connector's key, for a hand-off (me_embedSession): an /embed
// address that signs the frame in, good once and for one minute. That tool is
// listed for the card only, so the address never reaches the model.

export const APP_APP_URI = "ui://markbase/app";
export const OPEN_APP_TOOL = "me_openApp";
export const EMBED_SESSION_TOOL = "me_embedSession";

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

/** Look of the framed app, for any card that frames it. */
export const FRAME_APP_CSS = `
.stage { flex: 1; min-height: 0; position: relative; }
:root[data-mode="inline"] .stage { height: 640px; flex: none; }
iframe.app { border: 0; width: 100%; height: 100%; display: block; background: #fff; }
.fallback { padding: 32px 24px; display: grid; gap: 12px; justify-items: center; text-align: center; }
.fallback p { margin: 0; max-width: 28rem; }
`;

const CSS = `
html, body { height: 100%; }
body { padding: 0; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--mb-line); }
.bar .name { font-weight: 600; }
.bar .actions { display: flex; gap: 8px; }
.state { padding: 24px; text-align: center; }
` + FRAME_APP_CSS;

/**
 * frameApp(stage, docId, onFail, expand): frame the real app in `stage` at
 * docId (or the documents list), signed in through a card-only hand-off
 * (me_embedSession), and only if the hand-off is an address on this instance.
 * Needs CONFIG.instance, CONFIG.sessionTool and CONFIG.docUrlPrefix.
 *
 * `expand` asks for full page too, and is true only when called from a
 * click: Claude refuses a full-page request that no press asked for.
 *
 * Where the host will not let the card frame the instance — Claude allows a
 * connector's card only the sites it has approved for that connector — the
 * card says so and offers the document in Markbase instead of a blank frame.
 */
export const FRAME_APP_JS = String.raw`
function docAddress(docId) {
  return docId ? CONFIG.docUrlPrefix + encodeURIComponent(docId) : CONFIG.docUrlPrefix.replace(/\/$/, "");
}

function showFallback(stage, docId) {
  stage.innerHTML =
    '<div class="fallback"><p>This assistant does not show Markbase inside the chat yet.</p>' +
    '<button class="primary" id="fallback-open">' + CONFIG.icons.externalLink + "Open in Markbase</button></div>";
  document.getElementById("fallback-open").addEventListener("click", function () {
    mb.openLink(docAddress(docId)).catch(function () {});
  });
}

function frameApp(stage, docId, onFail, expand) {
  if (mb.frameAllowed(CONFIG.instance) === false) { showFallback(stage, docId); return; }
  stage.innerHTML = '<p class="state">Opening Markbase…</p>';
  if (expand && mb.canExpand() && mb.mode() !== "fullscreen") mb.setMode("fullscreen").catch(function () {});
  mb.callTool(CONFIG.sessionTool, docId ? { doc: docId } : {}).then(function (result) {
    var url = result.data && result.data.url;
    if (result.error || typeof url !== "string" || url.indexOf(CONFIG.instance + "/") !== 0) {
      onFail(result.error || "Markbase could not sign this card in.");
      return;
    }
    var frame = document.createElement("iframe");
    frame.className = "app";
    frame.title = "Markbase";
    frame.setAttribute("allow", "clipboard-read; clipboard-write");
    frame.src = url;
    stage.innerHTML = "";
    stage.appendChild(frame);
  }, function (err) {
    onFail((err && err.message) || "The assistant's app would not let this card sign in.");
  });
}
`;

const SCRIPT = String.raw`
var framed = false;

function show(html) { document.getElementById("stage").innerHTML = html; }

var openedDoc = null;

/*
 * The bar: the name, "Open full page" while the card is inline and the host
 * can show it full page (a press asks; Claude refuses an unasked request), and
 * "Open in Markbase" always, so the document is a click away whatever the
 * frame does.
 */
function drawBar() {
  var expand = mb.canExpand() && mb.mode() !== "fullscreen" && mb.frameAllowed(CONFIG.instance) !== false;
  document.getElementById("bar").innerHTML =
    '<span class="name">Markbase</span><span class="actions">' +
    (expand ? '<button class="primary" id="expand">' + CONFIG.icons.maximize + "Open full page</button>" : "") +
    '<button id="open-in">' + CONFIG.icons.externalLink + "Open in Markbase</button></span>";
  var button = document.getElementById("expand");
  if (button) button.addEventListener("click", function () { mb.setMode("fullscreen").then(drawBar, function () {}); });
  document.getElementById("open-in").addEventListener("click", function () {
    mb.openLink(docAddress(openedDoc)).catch(function () {});
  });
}

function open(docId) {
  if (framed) return;
  framed = true;
  openedDoc = docId;
  drawBar();
  frameApp(document.getElementById("stage"), docId, function (message) {
    framed = false;
    show('<p class="state error">' + escapeHtml(message) + "</p>");
  }, false);
}

mb.on("ui/notifications/tool-result", function (params) {
  var result = readToolResult(params);
  drawBar();
  if (result.error) { show('<p class="state error">' + escapeHtml(result.error) + "</p>"); return; }
  open(result.data && typeof result.data.doc_id === "string" ? result.data.doc_id : null);
});
mb.on("ui/notifications/host-context-changed", drawBar);
mb.start({ name: "markbase-app", version: "0.1.0", protocol: CONFIG.protocol });
`;

/** The page, for the instance at `instance` (an origin, no trailing slash). */
export function appAppHtml(instance: string): string {
  return appPage({
    title: "Markbase",
    css: CSS,
    body: '<div class="bar" id="bar"></div><div class="stage" id="stage"><p class="state">Loading…</p></div>',
    config: { instance, sessionTool: EMBED_SESSION_TOOL, docUrlPrefix: `${instance}/dashboard/documents/` },
    script: FRAME_APP_JS + SCRIPT,
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
