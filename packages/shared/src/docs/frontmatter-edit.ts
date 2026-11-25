import { dump as yamlDump } from "js-yaml";
import type { JSONValue } from "./types";

// Setting one front matter field in a document's markdown, leaving every other
// line exactly as it was written: the rest of the front matter (its quoting,
// its comments, dates written as dates) and the whole body. Re-serializing the
// front matter instead would rewrite what people typed, which is theirs.

/** The front matter block in three parts: the opening fence, what is inside, the closing fence. */
const BLOCK_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;

/** `key: value` as YAML, on as many lines as the value needs. */
function yamlLines(key: string, value: JSONValue): string {
  return yamlDump({ [key]: value }).trimEnd();
}

/**
 * The markdown with top-level front matter field `key` set to `value`.
 * Replaces the key's own lines when it is there, appends it when it isn't,
 * and gives a document with no front matter a block of its own above
 * everything else.
 */
export function withFrontmatterField(markdown: string, key: string, value: JSONValue): string {
  const block = BLOCK_RE.exec(markdown);
  if (!block) {
    return `---\n${yamlLines(key, value)}\n---\n${markdown.startsWith("\n") ? markdown : `\n${markdown}`}`;
  }
  const [whole, open, inner, close] = block;
  const lines = inner === "" ? [] : inner.split(/\r?\n/);
  const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
  const start = lines.findIndex((l) => keyRe.test(l));
  let next: string[];
  if (start === -1) {
    next = [...lines, yamlLines(key, value)];
  } else {
    // The key runs on through its indented lines, and a block list's "- "
    // items, which YAML lets sit at the key's own indent.
    let end = start + 1;
    while (end < lines.length && (/^\s/.test(lines[end]) || /^-(\s|$)/.test(lines[end]) || lines[end] === "")) end++;
    next = [...lines.slice(0, start), yamlLines(key, value), ...lines.slice(end)];
  }
  return `${open}${next.join("\n")}${close}${markdown.slice(whole.length)}`;
}
