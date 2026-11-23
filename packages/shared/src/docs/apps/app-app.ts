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

const CSS = `
html, body { height: 100%; }
body { padding: 0; display: flex; flex-direction: column; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--mb-line); }
.bar .name { font-weight: 600; }
.stage { flex: 1; min-height: 0; position: relative; }
:root[data-mode="inline"] .stage { height: 640px; flex: none; }
:root[data-mode="fullscreen"] .bar { display: none; }
iframe.app { border: 0; width: 100%; height: 100%; display: block; background: #fff; }
.state { padding: 24px; text-align: center; }
`;

const SCRIPT = String.raw`
var framed = false;

function show(html) { document.getElementById("stage").innerHTML = html; }

function drawBar() {
  var expand = mb.canExpand() && mb.mode() !== "fullscreen";
  document.getElementById("bar").innerHTML =
    '<span class="name">Markbase</span>' +
    (expand ? '<button class="primary" id="expand">' + CONFIG.icons.maximize + "Open full page</button>" : "");
  var button = document.getElementById("expand");
  if (button) button.addEventListener("click", function () { mb.setMode("fullscreen").then(drawBar, function () {}); });
}

function open(docId) {
  if (framed) return;
  framed = true;
  show('<p class="state">Opening Markbase…</p>');
  /* Full page is where the app belongs; a host that will not, or wants a click first, keeps it inline with a button. */
  if (mb.canExpand()) mb.setMode("fullscreen").then(drawBar, drawBar);
  mb.callTool(CONFIG.sessionTool, docId ? { doc: docId } : {}).then(function (result) {
    var url = result.data && result.data.url;
    if (result.error || typeof url !== "string" || url.indexOf(CONFIG.instance + "/") !== 0) {
      framed = false;
      show('<p class="state error">' + escapeHtml(result.error || "Markbase could not sign this card in.") + "</p>");
      return;
    }
    var frame = document.createElement("iframe");
    frame.className = "app";
    frame.title = "Markbase";
    frame.setAttribute("allow", "clipboard-read; clipboard-write");
    frame.src = url;
    var stage = document.getElementById("stage");
    stage.innerHTML = "";
    stage.appendChild(frame);
  }, function (err) {
    framed = false;
    show('<p class="state error">' + escapeHtml((err && err.message) || "The assistant's app would not let this card sign in.") + "</p>");
  });
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
    config: { instance, sessionTool: EMBED_SESSION_TOOL },
    script: SCRIPT,
  });
}

/** The app card for an instance. `instance` is the shell's to give: it is the only origin the card may frame. */
export function appApp(instance: string): McpApp {
  return {
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
