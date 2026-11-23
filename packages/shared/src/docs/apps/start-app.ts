import type { McpApp } from "../../mcp-http";
import { GET_STARTED_TOOL } from "../onboarding";
import { appPage } from "./page";

// The Get started card: what a person who has just connected their agent to
// Markbase sees when they ask what they can do.
//
// It answers the two things nobody can tell from a list of tools: what is in
// the account (the vault, the newest documents) and what to ask for. Each
// thing to try is a button, and pressing it sends that request into the
// conversation as the person's own message — so the first document is one
// press away rather than a sentence they have to think of.
//
// If the host will not send a message for a card, the button shows the words
// to type instead.

export const START_APP_URI = "ui://markbase/start";

const CSS = `
.lead { margin: 4px 0 0; }
h2 { margin: 16px 0 8px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: var(--mb-muted); }
.list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.try { width: 100%; justify-content: space-between; text-align: left; padding: 10px 12px; }
.try .text { display: grid; gap: 2px; }
.try .name { font-weight: 600; }
.try .about { font-weight: 400; font-size: 12.5px; opacity: 0.75; }
.docrow { width: 100%; justify-content: flex-start; text-align: left; padding: 8px 12px; font-weight: 400; }
.docrow .text { display: grid; min-width: 0; }
.docrow .name { font-weight: 550; }
.docrow .about { font-size: 12.5px; color: var(--mb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.say { margin: 6px 0 0; padding: 8px 12px; border-radius: var(--mb-radius); background: var(--mb-surface); font-size: 12.5px; }
.foot { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--mb-line); }
`;

const SCRIPT = String.raw`
function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

function draw(result) {
  var root = document.getElementById("root");
  var data = result.data;
  if (result.error || !data) {
    root.innerHTML = '<p class="state error">' + escapeHtml(result.error || "Markbase did not answer.") + "</p>";
    return;
  }
  var vaults = Array.isArray(data.vaults) ? data.vaults : [];
  var docs = Array.isArray(data.documents) ? data.documents : [];
  var tries = Array.isArray(data.suggestions) ? data.suggestions : [];

  var lead = vaults.length
    ? "Your " + (vaults.length === 1 ? "vault is " : "vaults are ") +
      vaults.map(function (v) { return "<strong>" + escapeHtml(v.name) + "</strong>"; }).join(", ") +
      ". Anything written for you here lands there, and you can open, edit and share it in Markbase."
    : "Anything written for you here is saved to Markbase, where you can open, edit and share it.";

  var html =
    '<h1 class="title">Markbase is connected</h1>' +
    '<p class="lead muted">' + lead + "</p>";

  if (tries.length) {
    html += "<h2>Try one</h2><ul class=\"list\">";
    for (var i = 0; i < tries.length; i++) {
      html +=
        '<li><button class="try' + (i === 0 ? " primary" : "") + '" data-try="' + i + '">' +
          '<span class="text"><span class="name">' + escapeHtml(tries[i].title) + '</span><span class="about">' + escapeHtml(tries[i].description) + "</span></span>" +
          '<span class="mark">' + CONFIG.icons.arrowRight + "</span>" +
        "</button></li>";
    }
    html += "</ul>";
  }

  if (docs.length) {
    html += "<h2>Your newest " + (docs.length === 1 ? "document" : "documents") + "</h2><ul class=\"list\">";
    for (var j = 0; j < docs.length; j++) {
      html +=
        '<li><button class="docrow" data-doc="' + j + '">' + CONFIG.icons.fileText +
          '<span class="text"><span class="name">' + escapeHtml(docs[j].title || "Untitled") + "</span>" +
          (docs[j].excerpt ? '<span class="about">' + escapeHtml(docs[j].excerpt) + "</span>" : "") +
        "</span></button></li>";
    }
    html += "</ul>";
  }

  html += '<div class="foot row spread"><span class="small muted">' + plural(vaults.length, "vault") +
    '</span><button id="open">' + CONFIG.icons.externalLink + "Open Markbase</button></div>";
  root.innerHTML = html;

  /* assigned, not added: the card may be drawn again, and one press must be one action */
  root.onclick = function (event) {
    var target = event.target && event.target.closest ? event.target.closest("button") : null;
    if (!target) return;
    if (target.id === "open") { mb.openLink(CONFIG.documentsUrl).catch(function () {}); return; }
    var docIndex = target.getAttribute("data-doc");
    if (docIndex !== null) {
      var doc = docs[Number(docIndex)];
      if (doc && typeof doc.id === "string") mb.openLink(CONFIG.docUrlPrefix + encodeURIComponent(doc.id)).catch(function () {});
      return;
    }
    var tryIndex = target.getAttribute("data-try");
    if (tryIndex === null || target.disabled) return;
    var suggestion = tries[Number(tryIndex)];
    if (!suggestion || typeof suggestion.prompt !== "string") return;
    target.disabled = true;
    mb.sendMessage(suggestion.prompt).then(function () {
      target.querySelector(".mark").innerHTML = CONFIG.icons.check;
    }, function () {
      /* the host would not send it: show the words instead */
      target.disabled = false;
      var item = target.parentNode;
      if (item.querySelector(".say")) return;
      var say = document.createElement("p");
      say.className = "say";
      say.textContent = "Type this to try it: " + suggestion.prompt;
      item.appendChild(say);
    });
  };
}

mb.on("ui/notifications/tool-result", function (params) { draw(readToolResult(params)); });
mb.on("ui/notifications/tool-cancelled", function () { draw({ error: "The request was cancelled." }); });
mb.start({ name: "markbase-start", version: "1.0.0", protocol: CONFIG.protocol });
`;

/** The page, for an instance whose documents open under `docUrlPrefix` and are listed at `documentsUrl`. */
export function startAppHtml(urls: { docUrlPrefix: string; documentsUrl: string }): string {
  return appPage({
    title: "Get started with Markbase",
    css: CSS,
    body: '<div id="root"><p class="state">Loading…</p></div>',
    config: { docUrlPrefix: urls.docUrlPrefix, documentsUrl: urls.documentsUrl },
    script: SCRIPT,
  });
}

/** The Get started card for an instance. The addresses are the shell's to give. */
export function startApp(urls: { docUrlPrefix: string; documentsUrl: string }): McpApp {
  return {
    uri: START_APP_URI,
    name: "Get started with Markbase",
    description: "Your vault, your newest documents and a few things to try, as buttons.",
    tools: [GET_STARTED_TOOL],
    html: startAppHtml(urls),
  };
}
