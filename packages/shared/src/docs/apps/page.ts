// The page every Markbase card is built from.
//
// A card is an MCP App (the `io.modelcontextprotocol/ui` extension): one HTML
// document the agent's app runs in a sandboxed frame, inside the conversation,
// and hands a tool's answer to. Claude shows them; a client that does not
// know the extension shows the tool's text answer, unchanged.
//
// A card is one self-contained page. Nothing is loaded from outside it — no
// script, font, image or request — so it asks the host for no domains and the
// host's default policy (no network at all) is the one it runs under. The
// protocol with the host is JSON-RPC over postMessage and is written out here
// by hand rather than bundled from an SDK, for the same reason: the page is
// the whole of what runs.
//
// Everything a card draws comes from a tool's answer, which is text a person
// or an agent wrote. It is escaped before it is put in the page, and a link is
// only ever opened by asking the host to (`ui/open-link`), never followed.
//
// The scripts are plain strings (String.raw, so a backslash is the script's
// own). They use no template literals: a backtick or a dollar-brace in them
// would end or open one here.

/** The version of the card protocol these pages speak. */
export const MCP_APP_PROTOCOL = "2026-01-26";

/**
 * Text handling with no page in it: escaping, which links may be opened,
 * markdown to HTML, and reading a tool's answer. Kept apart from the rest so
 * it can be run and tested without a browser.
 */
export const VIEW_LIB_JS = String.raw`
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* The address, if it is one a card may ask the host to open; else "". */
function safeHref(url) {
  var u = String(url == null ? "" : url).trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : "";
}

/* Inline markdown, on text that is NOT yet escaped. */
function renderInline(text) {
  var out = "";
  var parts = String(text).split(/(\x60[^\x60\n]+\x60)/);
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (i % 2 === 1) {
      out += "<code>" + escapeHtml(part.slice(1, -1)) + "</code>";
      continue;
    }
    var s = escapeHtml(part);
    /* images are not loaded: their text stands in for them */
    s = s.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)[^)]*\)/g, function (_m, alt) { return alt; });
    s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)[^)]*\)/g, function (_m, label, url) {
      /* the address was escaped with the rest; undo that to judge it, then escape it again */
      var raw = url.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      var href = safeHref(raw);
      return href ? '<a data-href="' + escapeHtml(href) + '" role="link" tabindex="0">' + label + "</a>" : label;
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    out += s;
  }
  return out;
}

function tableCells(line) {
  var t = line.trim();
  if (t.charAt(0) === "|") t = t.slice(1);
  if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
  return t.split("|").map(function (c) { return c.trim(); });
}

/* Markdown to HTML. Every character of the source is escaped on its way in. */
function renderMarkdown(md) {
  var lines = String(md == null ? "" : md).replace(/\r\n?/g, "\n").split("\n");
  var html = "";
  var i = 0;
  var listItem = /^\s*(?:[-*+]|\d+[.)])\s+/;
  while (i < lines.length) {
    var line = lines[i];
    if (!line.trim()) { i++; continue; }
    var fence = /^\s*(\x60{3,}|~{3,})/.exec(line);
    if (fence) {
      var body = [];
      i++;
      while (i < lines.length && lines[i].trim().indexOf(fence[1]) !== 0) { body.push(lines[i]); i++; }
      i++;
      html += "<pre><code>" + escapeHtml(body.join("\n")) + "</code></pre>";
      continue;
    }
    var heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      var level = heading[1].length;
      html += "<h" + level + ">" + renderInline(heading[2].replace(/\s+#+\s*$/, "")) + "</h" + level + ">";
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { html += "<hr>"; i++; continue; }
    if (/^\s*>/.test(line)) {
      var quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      html += "<blockquote>" + renderMarkdown(quoted.join("\n")) + "</blockquote>";
      continue;
    }
    if (line.indexOf("|") !== -1 && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      var head = tableCells(line);
      i += 2;
      var rows = "";
      while (i < lines.length && lines[i].trim() && lines[i].indexOf("|") !== -1) {
        rows += "<tr>" + tableCells(lines[i]).map(function (c) { return "<td>" + renderInline(c) + "</td>"; }).join("") + "</tr>";
        i++;
      }
      html += "<table><thead><tr>" + head.map(function (c) { return "<th>" + renderInline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows + "</tbody></table>";
      continue;
    }
    if (listItem.test(line)) {
      var ordered = /^\s*\d/.test(line);
      var items = "";
      while (i < lines.length && listItem.test(lines[i])) {
        var item = lines[i].replace(listItem, "");
        i++;
        /* a wrapped line of the same item */
        while (i < lines.length && lines[i].trim() && /^\s{2,}/.test(lines[i]) && !listItem.test(lines[i])) { item += " " + lines[i].trim(); i++; }
        var task = /^\[( |x|X)\]\s+/.exec(item);
        if (task) {
          items += '<li class="task"><span class="box' + (task[1] === " " ? "" : " done") + '"></span>' + renderInline(item.slice(task[0].length)) + "</li>";
        } else {
          items += "<li>" + renderInline(item) + "</li>";
        }
      }
      html += (ordered ? "<ol>" : "<ul>") + items + (ordered ? "</ol>" : "</ul>");
      continue;
    }
    var para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*>|\s*(\x60{3,}|~{3,}))/.test(lines[i]) && !listItem.test(lines[i])) { para.push(lines[i].trim()); i++; }
    html += "<p>" + renderInline(para.join(" ")) + "</p>";
  }
  return html;
}

/*
 * What a tool answered, from the notification the host sends: { data } when
 * it worked and its text is JSON, else { error } with what to say.
 */
function readToolResult(params) {
  var p = params || {};
  var text = "";
  var content = Array.isArray(p.content) ? p.content : [];
  for (var i = 0; i < content.length; i++) {
    if (content[i] && content[i].type === "text" && typeof content[i].text === "string") { text = content[i].text; break; }
  }
  if (p.isError) return { error: text || "The request failed." };
  if (p.structuredContent && typeof p.structuredContent === "object") return { data: p.structuredContent };
  try {
    var data = JSON.parse(text);
    if (data && typeof data === "object") return { data: data };
  } catch (e) { /* not JSON */ }
  return { error: "The answer could not be read." };
}
`;

/** The conversation with the host: the handshake, the theme, the size, and what a card may ask of it. */
const HOST_JS = String.raw`
var mb = (function () {
  var nextId = 1;
  var waiting = {};
  var handlers = {};

  function post(message) { window.parent.postMessage(message, "*"); }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      waiting[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }

  /* The host's theme and style variables, applied as it sends them. */
  var hostContext = {};
  /* What the host said it allows this card, from its answer to ui/initialize. */
  var hostCapabilities = {};

  function applyContext(context) {
    if (!context || typeof context !== "object") return;
    Object.keys(context).forEach(function (key) { hostContext[key] = context[key]; });
    document.documentElement.setAttribute("data-mode", hostContext.displayMode === "fullscreen" ? "fullscreen" : "inline");
    var root = document.documentElement;
    if (context.theme === "light" || context.theme === "dark") root.setAttribute("data-theme", context.theme);
    var variables = context.styles && context.styles.variables;
    if (variables && typeof variables === "object") {
      Object.keys(variables).forEach(function (name) {
        if (name.indexOf("--") === 0 && typeof variables[name] === "string") root.style.setProperty(name, variables[name]);
      });
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var m = event.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (typeof m.method === "string") {
      if (m.method === "ui/notifications/host-context-changed") applyContext(m.params);
      if (handlers[m.method]) handlers[m.method](m.params || {});
      /* a request from the host (it is about to remove the card, or checking it is there) */
      if (m.id !== undefined && m.id !== null) post({ jsonrpc: "2.0", id: m.id, result: {} });
      return;
    }
    var pending = waiting[m.id];
    if (!pending) return;
    delete waiting[m.id];
    if (m.error) pending.reject(new Error(m.error.message || "Refused")); else pending.resolve(m.result || {});
  });

  function reportSize() {
    var box = document.documentElement.getBoundingClientRect();
    notify("ui/notifications/size-changed", { width: Math.ceil(box.width), height: Math.ceil(box.height) });
  }

  function start(info) {
    request("ui/initialize", {
      protocolVersion: info.protocol,
      appInfo: { name: info.name, version: info.version },
      clientInfo: { name: info.name, version: info.version },
      appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] }
    }).then(function (result) {
      if (result && result.hostCapabilities && typeof result.hostCapabilities === "object") hostCapabilities = result.hostCapabilities;
      applyContext(result.hostContext);
      notify("ui/notifications/initialized", {});
      if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.documentElement);
      reportSize();
    }, function () { /* no host answered: the page stays as it is */ });
  }

  return {
    start: start,
    on: function (method, handler) { handlers[method] = handler; },
    openLink: function (url) { return request("ui/open-link", { url: url }); },
    sendMessage: function (text) { return request("ui/message", { role: "user", content: { type: "text", text: text } }); },
    /* Run one of this server's tools through the host; resolves to what readToolResult makes of the answer. */
    callTool: function (name, args) {
      return request("tools/call", { name: name, arguments: args || {} }).then(readToolResult);
    },
    /* Whether the host will show this card full page (in Claude: the panel beside the conversation). */
    canExpand: function () {
      return Array.isArray(hostContext.availableDisplayModes) && hostContext.availableDisplayModes.indexOf("fullscreen") !== -1;
    },
    mode: function () { return hostContext.displayMode === "fullscreen" ? "fullscreen" : "inline"; },
    /*
     * May this card frame the origin? true or false when the host said which
     * sites it let into the card's frame policy (hostCapabilities.sandbox.csp),
     * null when it did not say. Claude leaves out any site it does not allow
     * for the connector, and a frame of it would only ever be blank.
     */
    frameAllowed: function (origin) {
      var csp = hostCapabilities.sandbox && hostCapabilities.sandbox.csp;
      if (!csp || !Array.isArray(csp.frameDomains)) return null;
      return csp.frameDomains.indexOf(origin) !== -1;
    },
    /* Ask to be shown full page or inline; the host answers with the mode it chose. */
    setMode: function (mode) {
      return request("ui/request-display-mode", { mode: mode }).then(function (result) {
        applyContext({ displayMode: result && typeof result.mode === "string" ? result.mode : mode });
      });
    }
  };
})();

/* A link in drawn text is opened by the host, and only if it is one a card may open. */
document.addEventListener("click", function (event) {
  var el = event.target && event.target.closest ? event.target.closest("[data-href]") : null;
  if (!el) return;
  event.preventDefault();
  var href = safeHref(el.getAttribute("data-href"));
  if (href) mb.openLink(href).catch(function () {});
});
document.addEventListener("keydown", function (event) {
  if (event.key !== "Enter") return;
  var el = event.target && event.target.matches && event.target.matches("a[data-href]") ? event.target : null;
  if (el) el.click();
});
`;

/**
 * Shared look. The host's variables where it sends them, ours where it does
 * not; the accent is Markbase's lime, with near-black text on it in either
 * theme.
 */
const BASE_CSS = `
:root {
  color-scheme: light dark;
  --mb-fg: var(--color-text-primary, light-dark(#141413, #f4f3ee));
  --mb-muted: var(--color-text-secondary, light-dark(#5f5e5a, #b4b2a9));
  --mb-line: var(--color-border-primary, light-dark(#e2e0d8, #3e3e3a));
  --mb-surface: var(--color-background-secondary, light-dark(#f6f5f0, #2b2b29));
  --mb-accent: #e5ff6e;
  --mb-accent-fg: #141413;
  --mb-radius: var(--border-radius-md, 8px);
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body {
  padding: 16px;
  color: var(--mb-fg);
  font-family: var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
h1.title { margin: 0; font-size: 17px; line-height: 1.3; font-weight: 650; }
.muted { color: var(--mb-muted); }
.small { font-size: 12px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.spread { justify-content: space-between; }
.chip { border: 1px solid var(--mb-line); border-radius: 999px; padding: 1px 8px; font-size: 12px; color: var(--mb-muted); }
button, .btn {
  font: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--mb-line); border-radius: var(--mb-radius); background: transparent; color: var(--mb-fg);
  padding: 6px 12px; font-weight: 550;
}
button:hover { background: var(--mb-surface); }
button.primary { background: var(--mb-accent); color: var(--mb-accent-fg); border-color: transparent; }
button.primary:hover { filter: brightness(0.96); background: var(--mb-accent); }
button:focus-visible, a:focus-visible { outline: 2px solid var(--mb-fg); outline-offset: 2px; }
button:disabled { cursor: default; opacity: 0.6; }
svg.icon { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
a[data-href] { color: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.state { color: var(--mb-muted); }
.error { color: var(--color-text-danger, #c0392b); }
`;

/** Icons, drawn in the page: the paths are lucide's (the app's icon set). */
export const ICONS = {
  externalLink:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  fileText:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  arrowRight:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  maximize:
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>',
  chevronDown: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
} as const;

/** A value as it can sit inside a script element: JSON, with nothing that could close the element. */
export function scriptJson(value: { [name: string]: string | number | boolean | null | { [name: string]: string } }): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * One card's page. `config` is what the server knows and the page needs (an
 * address on this instance); `script` is the card's own code, which runs
 * after the shared ones and calls `mb.start`.
 */
export function appPage(page: {
  title: string;
  css: string;
  body: string;
  config: { [name: string]: string };
  script: string;
}): string {
  const config = scriptJson({ ...page.config, protocol: MCP_APP_PROTOCOL, icons: { ...ICONS } });
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${page.title}</title>`,
    `<style>${BASE_CSS}${page.css}</style>`,
    `</head><body>${page.body}`,
    `<script>var CONFIG = ${config};</script>`,
    `<script>${VIEW_LIB_JS}</script>`,
    `<script>${HOST_JS}</script>`,
    `<script>${page.script}</script>`,
    "</body></html>",
  ].join("\n");
}
