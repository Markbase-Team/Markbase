// Which version of a document is published.
//
// Publishing pins a VERSION, not the live text: the public page shows what was
// approved, and keeps showing it while the document goes on being edited. The
// pin is one number — an index into the version log — kept in the same Y.Doc
// as the content and the versions it points into:
//
//   Y.Doc
//   ├── "source"   : Y.Text
//   ├── "versions" : Y.Array
//   └── "publish"  : Y.Map   — { version: <index> }
//
// In the CRDT rather than a column for the reason the versions are: it travels
// with the document, and it can only ever point at a version that is there.
// Version indices are stable — the log is append-only.

import * as Y from "yjs";
import { getMarkdown } from "./crdt";
import { versionContent, versionCount } from "./versions";

const PUBLISH_KEY = "publish";
const VERSION_FIELD = "version";

/** The pinned version's index, or null when nothing is pinned (or the pin is out of range). */
export function pinnedVersion(doc: Y.Doc): number | null {
  const pin = doc.getMap<number>(PUBLISH_KEY).get(VERSION_FIELD);
  if (typeof pin !== "number" || !Number.isInteger(pin)) return null;
  return pin >= 0 && pin < versionCount(doc) ? pin : null;
}

/** Pin version `index` as the published one. */
export function pinVersion(doc: Y.Doc, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= versionCount(doc)) {
    throw new Error(`No version ${index}`);
  }
  doc.getMap<number>(PUBLISH_KEY).set(VERSION_FIELD, index);
}

/**
 * What the public page shows: the pinned version, or — for a document
 * published before pins existed — the text as it stands.
 */
export function publishedMarkdown(doc: Y.Doc): string {
  const pin = pinnedVersion(doc);
  return pin === null ? getMarkdown(doc) : versionContent(doc, pin);
}

/** Has the document moved on since the version that is published? */
export function behindPublished(doc: Y.Doc): boolean {
  const pin = pinnedVersion(doc);
  return pin !== null && versionContent(doc, pin) !== getMarkdown(doc);
}
