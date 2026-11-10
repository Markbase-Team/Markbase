import { describe, it, expect } from "vitest";
import { planAssetSync, mimeForPath } from "../src/vault-assets";

// Media on disk (roadmap A6, daemon half).
//
// The markdown says `![d](assets/d.png)`. For that to mean anything locally the
// FILE has to be there — that's the entire promise of "your vault is a folder":
// open it in Obsidian, offline, and the images render.
//
// So the daemon diffs the cloud's asset list against the folder. Unlike documents,
// assets are opaque bytes with no CRDT and no merge: an asset is either present or
// not. That makes the diff simple — and makes the CONTENT HASH the only honest way
// to compare, since a file's size and name say nothing about what's inside it.
const cloud = (path: string, sha256: string) => ({ path, sha256 });
const disk = (path: string, sha256: string) => ({ path, sha256 });

describe("planAssetSync", () => {
  it("does nothing when both sides match", () => {
    const c = [cloud("assets/a.png", "aaa")];
    const d = [disk("assets/a.png", "aaa")];
    expect(planAssetSync(c, d)).toEqual({ download: [], upload: [] });
  });

  it("downloads an asset the cloud has and the folder doesn't", () => {
    const plan = planAssetSync([cloud("assets/a.png", "aaa")], []);
    expect(plan.download).toEqual([{ path: "assets/a.png", sha256: "aaa" }]);
    expect(plan.upload).toEqual([]);
  });

  it("uploads an image dropped into the folder", () => {
    const plan = planAssetSync([], [disk("assets/new.png", "nnn")]);
    expect(plan.upload).toEqual(["assets/new.png"]);
    expect(plan.download).toEqual([]);
  });

  // The bytes are what matter, not the name. A file edited in place keeps its
  // path and its size may not even change — only the hash tells the truth.
  it("re-downloads when the same path holds different bytes", () => {
    const plan = planAssetSync([cloud("assets/a.png", "NEW")], [disk("assets/a.png", "old")]);
    expect(plan.download).toEqual([{ path: "assets/a.png", sha256: "NEW" }]);
  });

  it("handles a mix in one pass", () => {
    const plan = planAssetSync(
      [cloud("assets/keep.png", "k"), cloud("assets/pull.png", "p")],
      [disk("assets/keep.png", "k"), disk("assets/push.png", "u")]
    );
    expect(plan.download).toEqual([{ path: "assets/pull.png", sha256: "p" }]);
    expect(plan.upload).toEqual(["assets/push.png"]);
  });

  // An asset deleted in the cloud does NOT delete the local file. Documents are
  // restored from a CRDT if you delete them by mistake; an asset has no such
  // safety net — the bytes exist only where they exist. Removing someone's
  // original image because a row vanished is unrecoverable, so we never do it.
  // It gets re-uploaded instead, which is the reverse of destructive.
  it("never deletes a local file just because the cloud forgot it", () => {
    const plan = planAssetSync([], [disk("assets/precious.png", "x")]);
    expect(plan).not.toHaveProperty("delete");
    expect(plan.upload).toEqual(["assets/precious.png"]);
  });

  it("is stable when the two sides list things in different orders", () => {
    const c = [cloud("assets/b.png", "b"), cloud("assets/a.png", "a")];
    const d = [disk("assets/a.png", "a"), disk("assets/b.png", "b")];
    expect(planAssetSync(c, d)).toEqual({ download: [], upload: [] });
  });
});

// The browser gets a content type free — a pasted File carries one. The daemon
// reads bytes off a disk that stores no such thing, so an uploaded image landed
// as application/octet-stream and a signed URL then served it as a download
// rather than a picture. The extension is the only signal the filesystem gives us.
describe("mimeForPath", () => {
  it("names the common image types", () => {
    expect(mimeForPath("assets/a.png")).toBe("image/png");
    expect(mimeForPath("a.jpg")).toBe("image/jpeg");
    expect(mimeForPath("a.jpeg")).toBe("image/jpeg");
    expect(mimeForPath("a.gif")).toBe("image/gif");
    expect(mimeForPath("a.webp")).toBe("image/webp");
    expect(mimeForPath("a.svg")).toBe("image/svg+xml");
  });

  it("names video, audio and pdf", () => {
    expect(mimeForPath("a.mp4")).toBe("video/mp4");
    expect(mimeForPath("a.mp3")).toBe("audio/mpeg");
    expect(mimeForPath("a.pdf")).toBe("application/pdf");
  });

  it("is case-insensitive — Finder happily gives you SCREENSHOT.PNG", () => {
    expect(mimeForPath("SCREENSHOT.PNG")).toBe("image/png");
  });

  it("falls back to octet-stream for anything it can't name", () => {
    expect(mimeForPath("a.xyz")).toBe("application/octet-stream");
    expect(mimeForPath("noextension")).toBe("application/octet-stream");
  });
});
