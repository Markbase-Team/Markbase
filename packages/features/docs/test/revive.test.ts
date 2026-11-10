import { describe, it, expect, vi } from "vitest";
import { chooseRevival, type RevivalCandidate } from "../src/logic/revive";

// A file that leaves and comes back — a git branch switch — must be recognised
// as the document it was, or its comments and share links are stranded on an id
// nothing points at. Content is the proof; the path is an inference.

const reader = (byId: Record<string, string | null>) =>
  vi.fn(async (id: string) => (id in byId ? byId[id] : null));

describe("a file that came back", () => {
  it("is recognised by its content, even under a different name", async () => {
    const candidates: RevivalCandidate[] = [
      { id: "other", path: "other.md" },
      { id: "wanted", path: "old-name.md" },
    ];
    const got = await chooseRevival(
      { path: "new-name.md", content: "# Notes\n\nbody\n" },
      candidates,
      reader({ other: "# Something else\n", wanted: "# Notes\n\nbody\n" })
    );
    expect(got).toEqual({ id: "wanted", by: "content" });
  });

  it("ignores whitespace at the edges, which a checkout can add", async () => {
    const got = await chooseRevival(
      { path: "n.md", content: "# Notes\n\nbody" },
      [{ id: "a", path: "n.md" }],
      reader({ a: "# Notes\n\nbody\n\n" })
    );
    expect(got?.by).toBe("content");
  });

  it("tries the same path first, to save a round trip", async () => {
    const read = reader({ far: "no", near: "# Yes\n" });
    await chooseRevival(
      { path: "near.md", content: "# Yes\n" },
      [
        { id: "far", path: "far.md" },
        { id: "near", path: "near.md" },
      ],
      read
    );
    expect(read.mock.calls[0]?.[0]).toBe("near");
    expect(read).toHaveBeenCalledTimes(1); // the first one matched
  });
});

describe("when the content has changed too", () => {
  it("falls back to the path — a branch that edited as well as moved it", async () => {
    const got = await chooseRevival(
      { path: "n.md", content: "# Notes, revised\n" },
      [{ id: "a", path: "n.md" }],
      reader({ a: "# Notes\n" })
    );
    expect(got).toEqual({ id: "a", by: "path" });
  });

  it("does not reach for a different path on a guess", async () => {
    const got = await chooseRevival(
      { path: "new.md", content: "# Fresh\n" },
      [{ id: "a", path: "somewhere/else.md" }],
      reader({ a: "# Old\n" })
    );
    expect(got).toBeNull();
  });
});

describe("what it refuses to do", () => {
  it("returns nothing when there is nothing in the trash", async () => {
    expect(await chooseRevival({ path: "n.md", content: "x" }, [], reader({}))).toBeNull();
  });

  it("skips a candidate it cannot read rather than assuming a match", async () => {
    const got = await chooseRevival(
      { path: "n.md", content: "# Notes\n" },
      [{ id: "unreadable", path: "n.md" }],
      reader({ unreadable: null })
    );
    // Still path-eligible — but claimed as an inference, not as proof.
    expect(got).toEqual({ id: "unreadable", by: "path" });
  });

  it("stops reading after the cap, however many are in the trash", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, path: `d${i}.md` }));
    const read = reader({});
    await chooseRevival({ path: "nope.md", content: "x" }, many, read, 5);
    expect(read).toHaveBeenCalledTimes(5);
  });

  it("matches an empty file only against an empty document", async () => {
    const got = await chooseRevival(
      { path: "n.md", content: "" },
      [{ id: "full", path: "other.md" }],
      reader({ full: "# Has content\n" })
    );
    expect(got).toBeNull();
  });
});
