// Which media a document actually asks for.
//
// A vault used to upload every image it could find, on the reasoning that a
// note's pictures belong beside it. Pointed at a source repository that meant
// 3,179 files and 791 MB — of which exactly 21 were referenced by any document.
// "Has an image extension" was standing in for "a picture attached to a note",
// and the two are not the same thing.
//
// The markdown says which files it needs. That is the whole input:
//
//     ![diagram](assets/d.png)        -> assets/d.png
//     <img src="../img/a.png">        -> resolved against the document's folder
//     app/build/.../faceMask.png      -> nothing references it, so it stays put
//
// FINDING a reference is easy; RESOLVING it is where this earns its tests. Get it
// wrong and an image a note really does reference silently fails to upload, which
// is a worse bug than uploading too much: it looks like nothing happened.
//
// Here in the isomorphic protocol rather than the node vault, because the API
// answers the same question for a MEMBER of a document — which of its vault's
// assets may this person fetch — and the answer has to be the one the daemon
// computes, or an image the daemon wants is one the API withholds.

/**
 * Markdown image syntax and inline HTML. Both are common in real notes — Obsidian
 * writes the first, anything pasted from a webpage brings the second.
 */
const IMAGE_RE = /!\[[^\]]*\]\(([^)]+)\)|<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

/** Schemes that are not files in this vault. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * POSIX normalisation without node:path — `.` and `..` segments folded, with
 * a `..` that climbs past the root kept at the front so the caller can refuse
 * it (what `path.normalize` does too).
 */
function normalizePosix(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/**
 * Resolve one reference against the document that contains it.
 *
 * Returns a vault-relative POSIX path, or null when it does not name a file we
 * could hold: an external URL, a bare anchor, or something that climbs out of the
 * vault with `../`.
 */
export function resolveRef(docPath: string, raw: string): string | null {
  // `![a](img.png "title")` — markdown allows a title after the URL.
  let ref = raw.trim().replace(/\s+["'(].*$/, "").trim();
  // `<a.png>` is legal markdown for a path with spaces.
  if (ref.startsWith("<") && ref.endsWith(">")) ref = ref.slice(1, -1);
  // Strip the fragment/query a reference may carry (`x.png#page=2`).
  ref = ref.split("#")[0].split("?")[0];
  if (!ref) return null;
  if (EXTERNAL.test(ref)) return null; // http:, https:, data:, mailto:, //cdn…

  // Written by a browser or an editor, so spaces arrive as %20. A path on disk
  // has the space, not the escape — decode before comparing to anything real.
  try {
    ref = decodeURIComponent(ref);
  } catch {
    // Not valid encoding (a literal % in a filename). Use it as written.
  }

  // A leading slash means vault root, not filesystem root.
  //
  // The empty-dir case matters: a document AT the root has no folder, and
  // building `"" + "/" + ref` produced "/a.png", which the escape guard below
  // then rejected as absolute. Every root-level note lost its images.
  const dir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
  const joined = ref.startsWith("/") ? ref.slice(1) : dir ? `${dir}/${ref}` : ref;

  const resolved = normalizePosix(joined.split("\\").join("/"));
  // `../` that escapes the vault names a file we do not own.
  if (resolved.startsWith("../") || resolved === ".." || resolved.startsWith("/")) return null;
  return resolved || null;
}

/**
 * Every reference as WRITTEN in the markdown, unresolved. For a caller that
 * must resolve the same reference against two different document paths — a
 * shared document sits at the owner's path in their vault and at the member's
 * path in the member's folder, and the image it names has to be fetched from
 * the one and written to the other.
 */
export function rawRefsIn(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(IMAGE_RE)) out.push(m[1] ?? m[2] ?? "");
  return out;
}

/** Every vault-relative path the given markdown references. */
export function refsIn(docPath: string, markdown: string): string[] {
  const out: string[] = [];
  for (const raw of rawRefsIn(markdown)) {
    const resolved = resolveRef(docPath, raw);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** What a document set references, deduplicated. */
export function referencedAssets(docs: Iterable<{ path: string; markdown: string }>): Set<string> {
  const out = new Set<string>();
  for (const d of docs) for (const ref of refsIn(d.path, d.markdown)) out.add(ref);
  return out;
}
