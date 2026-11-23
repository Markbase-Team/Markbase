// Pure helpers for turning a document into a downloadable Markdown file —
// shared by the app's workspace download button and the published /download
// route. Serializing doc_json to markdown lives in `docJsonToMarkdown`.

// Filename slug from a document title, e.g. `My Doc!` -> `my-doc`. Falls back to
// `document` when the title has no usable characters.
export function docFileSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "document";
}

// Join a document's tab markdowns into one file — each tab already carries its
// own heading, so separate them with a blank line — ending with a trailing
// newline. Empty/whitespace-only tabs are dropped; returns "" if nothing remains.
export function combineTabMarkdown(parts: string[]): string {
  const body = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n");
  return body ? `${body}\n` : "";
}
