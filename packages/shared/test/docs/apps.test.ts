import { describe, expect, it } from "vitest";
import { agentTools } from "../../src/docs/agent-tools";
import { EMBED_TOOLS, appApp } from "../../src/docs/apps/app-app";
import { DOC_APP_TOOLS, DOC_APP_URI, docApp, docAppHtml } from "../../src/docs/apps/doc-app";
import { VIEW_LIB_JS, scriptJson } from "../../src/docs/apps/page";
import { START_APP_URI, startApp, startAppHtml } from "../../src/docs/apps/start-app";
import { GET_STARTED_TOOL, MCP_INSTRUCTIONS, MCP_PROMPTS, startSuggestions } from "../../src/docs/onboarding";

// The cards an agent's app shows in the conversation. Two things are under
// test: that what a card draws cannot be turned into markup or a link by the
// text of a document, and that each page is the whole of what runs — nothing
// is fetched, so the host's "no network" policy is the right one for it.

interface ViewLib {
  escapeHtml(s: string): string;
  safeHref(url: string): string;
  renderMarkdown(md: string): string;
  readToolResult(params: {
    content?: { type: string; text: string }[];
    isError?: boolean;
    structuredContent?: { [key: string]: string };
  }): { data?: { [key: string]: string | { [key: string]: string } }; error?: string };
}

// The page's text handling has no page in it, so it runs here as it will there.
const lib: ViewLib = new Function(`${VIEW_LIB_JS}; return { escapeHtml, safeHref, renderMarkdown, readToolResult };`)();

describe("what a card draws from a document's text", () => {
  it("escapes markup, wherever it sits", () => {
    const html = lib.renderMarkdown('# <script>alert(1)</script>\n\nA <img src=x onerror=alert(1)> b\n\n- <b>item</b>\n\n| <i>h</i> |\n| --- |\n| <u>c</u> |');
    expect(html).not.toMatch(/<(script|img|b|i|u)[\s>]/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes code, fenced and inline, without reading it as markdown", () => {
    const html = lib.renderMarkdown("```html\n<a href=\"x\">**b**</a>\n```\n\nUse `<br>` here");
    expect(html).toContain("<pre><code>&lt;a href=&quot;x&quot;&gt;**b**&lt;/a&gt;</code></pre>");
    expect(html).toContain("<code>&lt;br&gt;</code>");
  });

  it("keeps http, https and mailto links, as something the host is asked to open", () => {
    const html = lib.renderMarkdown("[site](https://example.com/a?b=1&c=2) and [mail](mailto:a@example.com)");
    expect(html).toContain('<a data-href="https://example.com/a?b=1&amp;c=2" role="link" tabindex="0">site</a>');
    expect(html).toContain('data-href="mailto:a@example.com"');
    // Never a real href: a card does not navigate, it asks.
    expect(html).not.toContain(" href=");
  });

  it("drops every other kind of link, keeping its words", () => {
    const html = lib.renderMarkdown("[x](javascript:alert(1)) [y](data:text/html,hi) [z](//evil.example) [w](vbscript:x)");
    expect(html).not.toContain("data-href");
    expect(html).toContain("x");
    expect(lib.safeHref(" JAVASCRIPT:alert(1)")).toBe("");
    expect(lib.safeHref("https://markbase.so/x")).toBe("https://markbase.so/x");
  });

  it("cannot be broken out of a link's address", () => {
    const html = lib.renderMarkdown('[a](https://example.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/onmouseover="/);
  });

  it("does not load images: their text stands in", () => {
    const html = lib.renderMarkdown("![a chart](https://example.com/c.png)");
    expect(html).toBe("<p>a chart</p>");
  });

  it("draws the markdown people write", () => {
    const html = lib.renderMarkdown(
      "# Title\n\nSome **bold**, *italic* and ~~gone~~ text.\n\n- one\n- [x] done\n- [ ] todo\n\n1. first\n2. second\n\n> quoted\n\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>, <em>italic</em> and <del>gone</del>");
    expect(html).toContain("<ul><li>one</li>");
    expect(html).toContain('<span class="box done"></span>done');
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>");
  });

  it("leaves snake_case and 2*3*4 alone", () => {
    expect(lib.renderMarkdown("call docs_read_doc and 2*3*4")).toBe("<p>call docs_read_doc and 2*3*4</p>");
  });
});

describe("how a card reads a tool's answer", () => {
  it("takes the JSON the tool answered with", () => {
    expect(lib.readToolResult({ content: [{ type: "text", text: '{"doc":{"id":"d1"}}' }], isError: false })).toEqual({
      data: { doc: { id: "d1" } },
    });
  });

  it("says what went wrong for a refusal", () => {
    expect(lib.readToolResult({ content: [{ type: "text", text: "HTTP 404\n{}" }], isError: true })).toEqual({ error: "HTTP 404\n{}" });
  });

  it("does not draw an answer it cannot read", () => {
    expect(lib.readToolResult({ content: [{ type: "text", text: "not json" }] }).error).toBeTruthy();
    expect(lib.readToolResult({}).error).toBeTruthy();
  });
});

describe("each card's page", () => {
  const pages = {
    doc: docAppHtml("https://markbase.so/dashboard/documents/"),
    start: startAppHtml({
      docUrlPrefix: "https://markbase.so/dashboard/documents/",
      documentsUrl: "https://markbase.so/dashboard/documents",
    }),
  };

  it.each(Object.entries(pages))("%s is self-contained: nothing is loaded from anywhere", (_name, html) => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<iframe\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
  });

  it.each(Object.entries(pages))("%s's scripts parse", (_name, html) => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(4);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });

  it.each(Object.entries(pages))("%s speaks to its host and never follows a link itself", (_name, html) => {
    expect(html).toContain('"ui/initialize"');
    expect(html).toContain('"ui/notifications/initialized"');
    expect(html).toContain('"ui/open-link"');
    expect(html).not.toMatch(/window\.open|location\.(href|assign|replace)/);
  });

  it("carries the instance's address, and that address cannot end the script it sits in", () => {
    expect(pages.doc).toContain('"docUrlPrefix":"https://markbase.so/dashboard/documents/"');
    const hostile = docAppHtml('https://x.example/</script><script>alert(1)</script>');
    expect(hostile.match(/<script>/g)).toHaveLength(4);
    expect(hostile).toContain("\\u003c/script>");
    expect(scriptJson({ a: "</script>" })).toBe('{"a":"\\u003c/script>"}');
  });

  it("the Get started card sends a suggestion as the person's message", () => {
    expect(pages.start).toContain('"ui/message"');
    expect(pages.start).toContain('role: "user"');
  });
});

describe("the cards and the tools they show", () => {
  const tools = agentTools().map((t) => t.name);

  it("point at tools that exist", () => {
    for (const tool of [...DOC_APP_TOOLS, GET_STARTED_TOOL]) expect(tools).toContain(tool);
  });

  it("are named and addressed as the host will ask for them", () => {
    const doc = docApp("https://markbase.so/dashboard/documents/");
    const start = startApp({ docUrlPrefix: "https://markbase.so/dashboard/documents/", documentsUrl: "https://markbase.so/dashboard/documents" });
    expect(doc.uri).toBe(DOC_APP_URI);
    expect(doc.tools).toEqual(["docs_readDoc", "docs_createDoc"]);
    expect(start.uri).toBe(START_APP_URI);
    expect(start.tools).toEqual(["docs_getStarted"]);
    expect(new Set([doc.uri, start.uri]).size).toBe(2);
  });
});

describe("what a newly connected person is offered", () => {
  it("is the three things to try: summarize, review, share", () => {
    expect(startSuggestions(null).map((s) => s.title)).toEqual([
      "Summarize this conversation as a document",
      "Review a document and comment on it",
      "Share a document with someone",
    ]);
  });

  it("names the newest document when there is one, and asks which when there is none", () => {
    const some = startSuggestions("Welcome to Markbase");
    expect(some[1].prompt).toContain('"Welcome to Markbase"');
    expect(some[2].prompt).toContain('"Welcome to Markbase"');
    const none = startSuggestions(null);
    expect(none[1].prompt).toContain("ask me which");
    expect(none[2].prompt).toContain("ask me which");
    for (const s of none) expect(s.prompt).toMatch(/Markbase/);
  });

  it("asks for a review without an edit, and says what to do when sharing is refused", () => {
    const [, review, share] = startSuggestions("Plan");
    expect(review.prompt).toContain("Do not edit the text");
    expect(share.prompt).toMatch(/view, comment or edit/);
    expect(share.prompt).toMatch(/Share button/);
  });

  it("tells the agent which tool to begin with, and that tool exists", () => {
    expect(MCP_INSTRUCTIONS).toContain(GET_STARTED_TOOL);
    for (const name of MCP_INSTRUCTIONS.match(/docs_[A-Za-z]+/g) ?? []) expect(agentTools().map((t) => t.name)).toContain(name);
  });

  it("has starters with distinct names", () => {
    expect(new Set(MCP_PROMPTS.map((p) => p.name)).size).toBe(MCP_PROMPTS.length);
  });
});

describe("a link whose address has brackets in it", () => {
  it("is taken whole, so nothing is left behind", () => {
    expect(lib.renderMarkdown("[bad](javascript:alert(1)).")).toBe("<p>bad.</p>");
    expect(lib.renderMarkdown("[wiki](https://en.wikipedia.org/wiki/Markdown_(disambiguation))")).toContain(
      'data-href="https://en.wikipedia.org/wiki/Markdown_(disambiguation)"'
    );
  });
});

describe("the app card (the embed experiment)", () => {
  const app = appApp("https://markbase.so");

  it("frames only the instance, gets its sign-in through a card-only tool, and is opened by me_openApp", () => {
    expect(app.frameDomains).toEqual(["https://markbase.so"]);
    expect(app.cardOnlyTools).toEqual(["me_embedSession"]);
    expect(app.tools).toEqual(["me_openApp"]);
    expect(EMBED_TOOLS.map((t) => t.name)).toEqual(["me_openApp", "me_embedSession"]);
  });

  it("frames a hand-off address only if it is on the instance", () => {
    expect(app.html).toContain('url.indexOf(CONFIG.instance + "/") !== 0');
    expect(app.html).toContain('"instance":"https://markbase.so"');
  });

  it("loads nothing of its own from anywhere, and its scripts parse", () => {
    expect(app.html).not.toMatch(/<script[^>]+src=|<link\b|<img\b|\bfetch\(|XMLHttpRequest/);
    for (const m of app.html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new Function(m[1])).not.toThrow();
  });
});

describe("the document card's Open full page (the embed experiment)", () => {
  it("is offered only while the embed is on, and frames only the instance through the card-only hand-off", () => {
    const off = docApp("https://markbase.so/dashboard/documents/");
    expect(off.cardOnlyTools).toBeUndefined();
    expect(off.frameDomains).toBeUndefined();
    expect(off.html).not.toContain("function frameApp(");

    const on = docApp("https://markbase.so/dashboard/documents/", "https://markbase.so");
    expect(on.cardOnlyTools).toEqual(["me_embedSession"]);
    expect(on.frameDomains).toEqual(["https://markbase.so"]);
    expect(on.html).toContain("function frameApp(");
    expect(on.html).toContain("Open full page");
    expect(on.html).toContain('"sessionTool":"me_embedSession"');
    for (const m of on.html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(() => new Function(m[1])).not.toThrow();
  });
});

describe("a card in an assistant that will not frame Markbase", () => {
  const app = appApp("https://markbase.so", "abc.claudemcpcontent.com");
  const doc = docApp("https://markbase.so/dashboard/documents/", "https://markbase.so", "abc.claudemcpcontent.com");

  it("asks the host which sites it allowed, and offers Open in Markbase instead of a blank frame", () => {
    expect(app.html).toContain("hostCapabilities.sandbox && hostCapabilities.sandbox.csp");
    expect(app.html).toContain('if (mb.frameAllowed(CONFIG.instance) === false) { showFallback(stage, docId); return; }');
    expect(app.html).toContain("does not show Markbase inside the chat yet");
    expect(app.html).toContain('"docUrlPrefix":"https://markbase.so/dashboard/documents/"');
  });

  it("asks for full page only from a press: the app card frames inline, the document card's button asks", () => {
    expect(app.html).toContain("if (expand && mb.canExpand()");
    expect(app.html).toMatch(/frameApp\(document\.getElementById\("stage"\), docId, function \(message\) \{[\s\S]*?\}, false\);/);
    expect(doc.html).toMatch(/frameApp\(document\.getElementById\("stage"\), doc\.id, function \(message\) \{[\s\S]*?\}, true\);/);
  });

  it("gives the framing cards their fixed sandbox host", () => {
    expect(app.domain).toBe("abc.claudemcpcontent.com");
    expect(doc.domain).toBe("abc.claudemcpcontent.com");
    expect(docApp("https://markbase.so/dashboard/documents/").domain).toBeUndefined();
  });
});
