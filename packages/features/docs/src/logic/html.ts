import MarkdownIt from "markdown-it";
import markdownItMark from "markdown-it-mark";

// Lightweight markdown → HTML for the public published page. No tiptap here, so
// server pages can import it cheaply. html:false blocks raw embedded HTML; the
// default preset gives GFM tables + strikethrough; linkify auto-links URLs.
const md = MarkdownIt({ html: false, linkify: true, typographer: true }).use(
  markdownItMark
);

// A ```mermaid fence becomes a placeholder carrying its source, for the client to
// draw. It cannot be drawn here: mermaid measures text to lay a diagram out, so
// it needs a DOM, and a server component has none. Emitting the source in a
// recognisable element keeps this function pure string work and leaves the page
// readable — the diagram's text is present — if the script never runs.
const fence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if ((token.info ?? "").trim().toLowerCase() === "mermaid") {
    // Escaped: this is published content, and it lands in innerHTML.
    return `<pre class="mermaid-source">${md.utils.escapeHtml(token.content)}</pre>\n`;
  }
  return fence
    ? fence(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

export function markdownToHtml(markdown: string): string {
  return md.render(markdown ?? "");
}

// A plain-text excerpt for <meta description> / OG (strip markdown, collapse ws).
export function excerpt(markdown: string, max = 155): string {
  const text = (markdown ?? "")
    .replace(/```[\s\S]*?```/g, "") // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → their text
    .replace(/[#>*_`~]+/g, " ") // md punctuation
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
