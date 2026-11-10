import { MENTION_HREF_PREFIX } from "./extensions";

// A mention is stored in markdown as `[@Label](agent:<id>)` (see markdown.ts).
// This pulls the agent-session ids back out of a comment or document body so the
// server can dispatch to them. Ids are uuids, so the pattern is tight enough not
// to match ordinary links.
const MENTION_RE = new RegExp(
  `\\]\\(${MENTION_HREF_PREFIX}([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\)`,
  "g"
);

/** Unique agent-session ids mentioned in `markdown`, in first-seen order. */
export function parseMentions(markdown: string): string[] {
  const seen = new Set<string>();
  for (const m of (markdown ?? "").matchAll(MENTION_RE)) {
    seen.add(m[1].toLowerCase());
  }
  return [...seen];
}

/** Strip mention syntax down to readable text: `[@Name](agent:id)` -> `@Name`. */
export function stripMentionSyntax(markdown: string): string {
  return (markdown ?? "").replace(
    new RegExp(`\\[(@[^\\]]*)\\]\\(${MENTION_HREF_PREFIX}[^)]*\\)`, "g"),
    "$1"
  );
}
