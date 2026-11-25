import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setMarkdown } from "@markbase/shared/docs/crdt";
import { restore, snapshot } from "@markbase/shared/docs/sync";
import { createDoc } from "@markbase/shared/docs/crdt";
import { listVersions, versionCount } from "@markbase/shared/docs/versions";
import { lineCredit, writerText } from "@markbase/shared/docs/analytics";
import type { Actor } from "../src/server/auth";

// Every change the API makes to a document's text goes through one seam,
// editDocCrdt, and the seam records it as a version in the writer's name.
//
// Why the seam and not the handlers: a version is what history and "Who wrote
// it" are built from, and a handler that forgot to cut one left the text
// unrecorded until the next open window's idle ticker claimed it for whoever
// was reading. A document Codex created showed "Not recorded yet", then the
// person's name. Three of five writers had forgotten. So no handler records
// anything; the seam does, and the first test here keeps it that way.

const HANDLERS = join(__dirname, "../src/handlers");

describe("handlers never record a version themselves", () => {
  for (const file of readdirSync(HANDLERS).filter((f) => f.endsWith(".ts"))) {
    it(`${file} leaves it to the seam`, () => {
      const text = readFileSync(join(HANDLERS, file), "utf8");
      expect(text).not.toMatch(/\b(checkpoint|appendVersion)\b/);
    });
  }
});

// --- The seam itself, with the store in memory. ---

const snapshots = new Map<string, Uint8Array>();
const loadCrdtSnapshot = vi.fn(async (id: string) => {
  const state = snapshots.get(id);
  return state ? { state, version: 1 } : null;
});
const saveCrdtSnapshot = vi.fn(async (id: string, state: Uint8Array) => {
  snapshots.set(id, state);
  return { changed: true, state, version: 2 };
});
vi.mock("../src/server/properties", () => ({ indexDocProperties: async () => true }));
vi.mock("../src/server/crdt-store", () => ({
  loadCrdtSnapshot: (id: string) => loadCrdtSnapshot(id),
  saveCrdtSnapshot: (id: string, s: Uint8Array) => saveCrdtSnapshot(id, s),
  broadcastCrdt: async () => undefined,
}));
vi.mock("../src/server/documents", () => ({ mirrorDocContent: async () => undefined }));

const { editDocCrdt } = await import("../src/server/doc-crdt");

const CODEX: Actor = {
  kind: "agent",
  userId: "owner_1",
  name: "Jessie's Codex",
  agent: { owner: "Jessie", tool: "codex" },
};
const JESSIE: Actor = { kind: "user", userId: "owner_1", name: "Jessie" };

/** The document as the cloud now holds it. */
function stored(id: string) {
  return restore(snapshots.get(id)!);
}

beforeEach(() => {
  snapshots.clear();
});

describe("editDocCrdt records what it changed", () => {
  it("credits an edit to the agent, owner and tool apart", async () => {
    await editDocCrdt("d1", "# Notes\n\nfirst\n", { actor: JESSIE }, () => undefined);
    await editDocCrdt("d1", "", { actor: CODEX }, (doc) => setMarkdown(doc, "# Notes\n\nfirst\nsecond\n"));

    const doc = stored("d1");
    expect(listVersions(doc).map((v) => ({ author: v.author, agents: v.agents }))).toEqual([
      { author: "Jessie", agents: undefined },
      { author: "Jessie", agents: ["codex"] },
    ]);
    const credit = lineCredit(doc);
    expect(credit.ranges.map((r) => [r.from, r.to, writerText(r.writer)])).toEqual([
      [1, 3, "Jessie"],
      [4, 4, "Jessie's Codex"],
    ]);
  });

  it("cuts the first version for a write that changes nothing — creation", async () => {
    // Creating a document is a write of nothing onto its seed. Without a
    // version the seed is nobody's, and the next viewer's ticker takes it.
    await editDocCrdt("d1", "# Notes\n", { actor: CODEX, label: "Created" }, () => undefined);

    const doc = stored("d1");
    expect(versionCount(doc)).toBe(1);
    expect(listVersions(doc)[0]).toMatchObject({ label: "Created", author: "Jessie", agents: ["codex"] });
    expect(writerText(lineCredit(doc).shares[0].writer)).toBe("Jessie's Codex");
  });

  it("records nothing for a write that changes nothing on a document with history", async () => {
    await editDocCrdt("d1", "# Notes\n", { actor: JESSIE }, () => undefined);
    await editDocCrdt("d1", "", { actor: CODEX }, () => undefined);
    expect(versionCount(stored("d1"))).toBe(1);
  });

  it("does not claim what the writer only looked at", async () => {
    // Text that arrived unrecorded (typed in a browser whose ticker had not
    // fired) is not re-credited by a write that leaves it alone.
    const doc = createDoc("# Notes\n");
    snapshots.set("d1", snapshot(doc));
    await editDocCrdt("d1", "", { actor: JESSIE }, () => undefined); // first version: the seed, Jessie's
    const typed = stored("d1");
    setMarkdown(typed, "# Notes\n\nunrecorded\n", "editor");
    snapshots.set("d1", snapshot(typed));

    await editDocCrdt("d1", "", { actor: CODEX, label: "Published" }, () => undefined);
    expect(versionCount(stored("d1"))).toBe(1);
  });

  it("keeps the label a caller gives the version", async () => {
    await editDocCrdt("d1", "a\n", { actor: JESSIE }, () => undefined);
    await editDocCrdt("d1", "", { actor: JESSIE, label: "Restored version 1" }, (doc) => setMarkdown(doc, "b\n"));
    expect(listVersions(stored("d1"))[1].label).toBe("Restored version 1");
  });
});
