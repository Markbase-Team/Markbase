import { leadingH1, splitFrontmatter } from "./markdown";

/** How much prose a list row shows. Two lines of a sidebar, with room to spare. */
export const EXCERPT_LENGTH = 160;

/**
 * The opening prose of a document, as a list row shows it under the title.
 *
 * What is dropped: frontmatter (metadata, not prose), the leading h1 (it IS the
 * title — repeating it under the title says nothing), and markdown's own
 * punctuation (fences, heading marks, emphasis, list bullets, link targets,
 * images, HTML). What is left reads like the first sentence or two of the
 * document itself. Whitespace collapses so a paragraph break is one space and
 * the row never shows a blank.
 *
 * Takes the head of the markdown, not the whole document: the list endpoint
 * sends the first kilobyte (see the `content_head` column), which is more than
 * enough for `max` characters of prose after the stripping above.
 */
export function docExcerpt(
  markdown: string | null | undefined,
  max = EXCERPT_LENGTH
): string {
  const { body } = splitFrontmatter(markdown ?? "");
  const prose = stripMarkdown(leadingH1(body) === null ? body : dropFirstLine(body));
  if (prose.length <= max) return prose;
  // Cut on a word boundary, so the row ends on a word rather than mid-syllable.
  const cut = prose.lastIndexOf(" ", max);
  return prose.slice(0, cut > max / 2 ? cut : max).replace(/[\s,;:]+$/, "") + "…";
}

/** The markdown after its first non-blank line — the leading h1, once found. */
function dropFirstLine(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim());
  return at < 0 ? "" : lines.slice(at + 1).join("\n");
}

function stripMarkdown(markdown: string): string {
  return (
    markdown
      // Fenced code: the fence lines go, the code inside stays as text.
      .replace(/^\s{0,3}(```|~~~).*$/gm, "")
      // Images contribute nothing a line of text can show.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // Links keep their text; wiki links keep their target (it is the text).
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => label ?? target)
      .replace(/<[^>]+>/g, "")
      // Line-leading structure: heading marks, blockquotes, bullets, numbers,
      // task boxes — each in any combination ("> - [ ] item").
      .replace(/^[ \t]*(?:(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+|\[[ xX]\][ \t]+)+/gm, "")
      // Rules and table borders are lines of punctuation, not words.
      .replace(/^[ \t]*(?:[-*_]{3,}|\|?(?:\s*:?-+:?\s*\|)+)[ \t]*$/gm, "")
      .replace(/\|/g, " ")
      // Emphasis, strikethrough, highlight, inline code: the marks go, the text stays.
      .replace(/(\*{1,3}|_{1,3}|~~|==|`+)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/\s+/g, " ")
      .trim()
  );
}
