import { describe, it, expect } from "vitest";
import { createDoc, setMarkdown } from "../src/logic/crdt";
import { checkpoint, versionCount } from "../src/logic/versions";
import { behindPublished, pinVersion, pinnedVersion, publishedMarkdown } from "../src/logic/publish-pin";

// Publishing pins a version: the public page shows that version and keeps
// showing it while the document goes on being edited.

function docWithVersions(...texts: string[]) {
  const doc = createDoc("");
  for (const t of texts) {
    setMarkdown(doc, t, "editor");
    checkpoint(doc);
  }
  return doc;
}

describe("the publish pin", () => {
  it("is unset on a document nobody pinned, which publishes its live text", () => {
    const doc = docWithVersions("one\n");
    setMarkdown(doc, "one, edited\n", "editor");
    expect(pinnedVersion(doc)).toBeNull();
    expect(publishedMarkdown(doc)).toBe("one, edited\n");
    expect(behindPublished(doc)).toBe(false);
  });

  it("keeps serving the pinned version while the document moves on", () => {
    const doc = docWithVersions("first\n", "second\n");
    pinVersion(doc, 1);
    expect(publishedMarkdown(doc)).toBe("second\n");
    expect(behindPublished(doc)).toBe(false);

    setMarkdown(doc, "second, still being written\n", "editor");
    expect(publishedMarkdown(doc)).toBe("second\n");
    expect(behindPublished(doc)).toBe(true);
  });

  it("can pin an older version, which then reads as behind", () => {
    const doc = docWithVersions("first\n", "second\n");
    pinVersion(doc, 0);
    expect(pinnedVersion(doc)).toBe(0);
    expect(publishedMarkdown(doc)).toBe("first\n");
    expect(behindPublished(doc)).toBe(true);
  });

  it("refuses a version that does not exist", () => {
    const doc = docWithVersions("first\n");
    expect(versionCount(doc)).toBe(1);
    expect(() => pinVersion(doc, 1)).toThrow();
    expect(() => pinVersion(doc, -1)).toThrow();
    expect(pinnedVersion(doc)).toBeNull();
  });
});
