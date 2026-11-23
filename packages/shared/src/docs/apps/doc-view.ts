// A document, drawn by a card: what the document card shows, and what the app
// card shows while (or instead of) the real app. Drawn from a tool's answer
// (`{ doc: { id, title, content, … }, capability? }`), escaped, with nothing
// loaded from anywhere — so it shows in any host, whatever sites it allows.
//
// "Open full page" asks the host for full page (from the press, which Claude
// requires) and shows the whole document there. Where the card may frame the
// app (CONFIG.instance), it also lays the real app over the document
// (./frame), which shows only if it loads. "Open in Markbase" opens the
// document through /open: the desktop app first, the website otherwise.

export const DOC_VIEW_CSS = `
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
/* Full page: a reading column, the whole document. */
:root[data-mode="fullscreen"] #root { max-width: 760px; margin: 0 auto; }
`;

export const DOC_VIEW_JS = String.raw`
var ROLES = { owner: "Owner", editor: "Can edit", commenter: "Can comment", viewer: "Can view" };
var lastDrawn = null;

function when(iso) {
  var date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function draw(result) {
  lastDrawn = result;
  var root = document.getElementById("root");
  var doc = result.data && result.data.doc;
  if (result.error || !doc || typeof doc.id !== "string") {
    root.innerHTML = '<p class="state error">' + escapeHtml(result.error || "There is no document in this answer.") + "</p>";
    return;
  }
  var full = mb.mode() === "fullscreen";
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
          (!full && mb.canExpand() ? '<button id="full">' + CONFIG.icons.maximize + "Open full page</button>" : "") +
          '<button class="primary" id="open">' + CONFIG.icons.externalLink + "Open in Markbase</button>" +
        "</div>" +
      "</div>" +
      (chips ? '<div class="row meta">' + chips + "</div>" : "") +
    "</div>" +
    '<div class="doc" id="doc">' + (String(doc.content || "").trim() ? renderMarkdown(doc.content) : '<p class="muted">This document is empty.</p>') + "</div>" +
    '<div class="more" id="more" hidden><button id="toggle">' + CONFIG.icons.chevronDown + "<span>Show more</span></button></div>";

  /* Full page, from the press: the whole document, and the real app over it if it loads. */
  var fullButton = document.getElementById("full");
  if (fullButton) fullButton.addEventListener("click", function () {
    mb.setMode("fullscreen").then(function () {
      draw(lastDrawn);
      if (typeof overlayApp === "function") overlayApp(doc.id);
    }, function () {});
  });

  document.getElementById("open").addEventListener("click", function () {
    mb.openLink(CONFIG.docUrlPrefix + encodeURIComponent(doc.id)).catch(function () {});
  });

  /* In the conversation a long document is cut short; full page shows it all. */
  var body = document.getElementById("doc");
  if (!full && body.scrollHeight > 400) {
    body.classList.add("clamped");
    document.getElementById("more").hidden = false;
    document.getElementById("toggle").addEventListener("click", function () {
      var clamped = body.classList.toggle("clamped");
      this.querySelector("span").textContent = clamped ? "Show more" : "Show less";
    });
  }
}

/* The host moving the card (to full page and back) redraws it from the same answer. */
mb.on("ui/notifications/host-context-changed", function () { if (lastDrawn) draw(lastDrawn); });
`;
