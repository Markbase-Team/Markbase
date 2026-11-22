// Media in a vault (roadmap A6) — the link layer.
//
// The markdown holds a VAULT-RELATIVE path: `![d](assets/diagram.png)`, never a
// Supabase URL. That is the portability promise the whole product rests on — the
// vault is markdown in a folder, so it has to keep working in Obsidian, in git,
// and offline. A remote URL baked into the text breaks all three, and rots the day
// someone stops paying us.
//
// So each surface RESOLVES the path instead: the web maps it to a storage URL to
// render, and on disk the file is simply there. Both directions are the same
// operation — rewrite each image's target through a function.
//
// Y.Text is the truth and it holds raw markdown, so this is text surgery, and it
// must be careful: an image inside a code block is content the user wrote on
// purpose (documentation about markdown is exactly what people keep here), and
// rewriting it would corrupt their writing.

/** One image reference in the markdown, with the span of the whole `![…](…)`. */
export interface ImageRef {
  alt: string;
  target: string;
  /** Index of the leading `!`. */
  start: number;
  /** Index just past the closing `)`. */
  end: number;
}

// ![alt](target "optional title")
//
// The target may contain SPACES: image files pasted from a screenshot are named
// like "Screenshot 2026-07-21 at 12.13.52 PM.png", and Obsidian references them
// with the space intact. So accept both forms — a `<…>`-wrapped target (CommonMark)
// and a bare one with spaces (group 3, lazy so a trailing `"title"` stays out of
// it). A bare `[^)\s]+` would silently skip every spaced image, leaving it as raw
// text that renders as a broken link instead of a picture.
const IMAGE_RE = /!\[([^\]]*)\]\(\s*(?:<([^>\n]*)>|([^)\n]*?))\s*(?:"[^"]*")?\s*\)/g;

/** Byte ranges covered by fenced blocks or inline code spans — off limits. */
function codeRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  // Fenced blocks: ``` or ~~~ (with an optional info string), up to a closing
  // fence — or the end of the document if the fence was never closed.
  //
  // That last alternative must be end-of-STRING, not `$`: under /m, `$` matches at
  // every line end, so the lazy body stopped after line one and the CLOSING fence
  // was then read as a new OPENING fence — swallowing the real image after it.
  // `(?![\s\S])` is the end-of-input anchor that /m can't reinterpret.
  const fence = /^[ \t]*(```+|~~~+)[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|(?![\s\S]))/gm;
  for (const m of markdown.matchAll(fence)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  // Inline code spans, ignoring any that fall inside a fence we already have.
  const inline = /`+[^`\n]*`+/g;
  for (const m of markdown.matchAll(inline)) {
    const [s, e] = [m.index, m.index + m[0].length];
    if (!ranges.some(([rs, re]) => s >= rs && e <= re)) ranges.push([s, e]);
  }
  return ranges;
}

function inRanges(i: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => i >= s && i < e);
}

/** Every image reference in the markdown, skipping anything inside code. */
export function imageRefs(markdown: string): ImageRef[] {
  const skip = codeRanges(markdown);
  const out: ImageRef[] = [];
  for (const m of markdown.matchAll(IMAGE_RE)) {
    if (inRanges(m.index, skip)) continue;
    // m[2] = a <…>-wrapped target, m[3] = a bare one. `??` keeps an empty <> target.
    out.push({ alt: m[1], target: m[2] ?? m[3], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Is this target somebody else's to serve? An http(s) URL, a protocol-relative
 * one, or a data URI is not a vault file — pasting a link to an image on the web
 * must keep pointing there, not become a broken local path.
 */
export function isExternalRef(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

/**
 * Rewrite every image target through `map`. Return null from `map` to leave a
 * reference exactly as it is (an external URL, or one you don't recognise).
 *
 * Rebuilt back-to-front so each edit can't shift the spans of the ones before it.
 */
export function rewriteImageRefs(
  markdown: string,
  map: (target: string) => string | null
): string {
  const refs = imageRefs(markdown);
  let out = markdown;
  for (let i = refs.length - 1; i >= 0; i--) {
    const r = refs[i];
    const next = map(r.target);
    if (next === null || next === r.target) continue;
    // Keep the alt and the title; only the target moves.
    const original = markdown.slice(r.start, r.end);
    const title = /\s+"[^"]*"(?=\s*\)$)/.exec(original)?.[0] ?? "";
    // A bare target with spaces isn't valid markdown — wrap it in <> (CommonMark),
    // which readers and Obsidian accept, so the round-trip stays a real image.
    const encoded = /\s/.test(next) ? `<${next}>` : next;
    out = out.slice(0, r.start) + `![${r.alt}](${encoded}${title})` + out.slice(r.end);
  }
  return out;
}

/** A vault asset and where it can currently be fetched. */
export interface AssetLink {
  /** Vault-relative path, exactly as the markdown references it. */
  path: string;
  /** A URL the browser can load right now (signed, and therefore temporary). */
  url: string;
}

/**
 * Two pure markdown transforms at the derive/serialize seam.
 *
 * Y.Text stores `assets/d.png` — always; that's the truth contract. But a browser
 * can't render that: it resolves against the page URL and 404s. So the editor is
 * shown URLs and hands back URLs, while storage only ever sees paths. Neither side
 * has to know about the other.
 */
export interface MarkdownLens {
  /** Stored markdown → what the editor should display. */
  toEditor(markdown: string): string;
  /** Editor markdown → what Y.Text should store. */
  toStorage(markdown: string): string;
}

/** A URL without its query — signed URLs carry a token that changes on every mint. */
function stripQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}

/**
 * Knows which vault path each asset URL stands for, and vice versa.
 *
 * Mutable on purpose: a freshly pasted image must resolve immediately, without
 * refetching the whole asset list just to see what you dropped a moment ago.
 */
export class MediaRegistry {
  private readonly urlByPath = new Map<string, string>();
  /** Keyed by URL-without-query — see `add`. */
  private readonly pathByUrl = new Map<string, string>();

  constructor(links: AssetLink[] = []) {
    for (const l of links) this.add(l);
  }

  add(link: AssetLink): void {
    this.urlByPath.set(link.path, link.url);
    // Key on the URL minus its query: a signed URL's token is re-minted on every
    // fetch of the list, so the same object is a different string an hour later.
    // Matching whole URLs would quietly fail to map it home, losing the path.
    this.pathByUrl.set(stripQuery(link.url), link.path);
  }

  urlForPath(path: string): string | null {
    return this.urlByPath.get(path) ?? null;
  }

  pathForUrl(url: string): string | null {
    return this.pathByUrl.get(stripQuery(url)) ?? null;
  }

  lens(): MarkdownLens {
    return {
      toEditor: (md) =>
        rewriteImageRefs(md, (t) => (isExternalRef(t) ? null : this.urlForPath(t))),
      toStorage: (md) => rewriteImageRefs(md, (t) => this.pathForUrl(t)),
    };
  }
}

/** A stored object as the bucket lists it. */
export interface StoredObject {
  /** The object's name within the vault's prefix — its sha256. */
  name: string;
  created_at: string;
}

/**
 * Which objects a sweep may delete: unclaimed by any row, AND old enough that
 * they can't be mid-upload.
 *
 * The grace period is the whole point. putAsset uploads bytes and THEN writes the
 * row — deliberately, since an object with no row is harmless garbage while a row
 * with no object is a broken image. But that ordering means an object legitimately
 * has no row for a moment, and a sweep landing in that window would delete the
 * picture someone just pasted. Deleting user bytes is unrecoverable, so anything
 * we can't prove is abandoned — including one whose timestamp won't parse — stays.
 */
export function selectOrphans(
  objects: StoredObject[],
  claimedShas: ReadonlySet<string>,
  now: number,
  graceMs: number
): string[] {
  return objects
    .filter((o) => {
      if (claimedShas.has(o.name)) return false;
      const age = now - Date.parse(o.created_at);
      return Number.isFinite(age) && age >= graceMs;
    })
    .map((o) => o.name);
}

/** Filesystem-safe single path segment. */
function sanitizeSegment(s: string): string {
  return s.replace(/[/\\:*?"<>|]+/g, "-").trim();
}

/**
 * Where a newly-added asset lives in the vault. Assets sit in one `assets/`
 * folder — the convention Obsidian and most markdown tooling already expect, so a
 * vault opened elsewhere looks normal rather than like our private layout.
 *
 * Collisions get a numeric suffix on the STEM, so the extension keeps working.
 */
export function assetPathFor(
  filename: string,
  taken: Iterable<string>,
  folder = "assets"
): string {
  const used = new Set(taken);
  const clean = sanitizeSegment(filename) || "image";
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";

  let candidate = `${folder}/${stem}${ext}`;
  for (let n = 1; used.has(candidate); n++) candidate = `${folder}/${stem}-${n}${ext}`;
  return candidate;
}
