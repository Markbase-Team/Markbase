import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDoc, setMarkdown } from "../src/logic/crdt";
import { snapshot } from "../src/logic/sync";

// A published page shows the document as it stands now — the CRDT — not the
// row's `content`, which is a mirror only some writers keep in step. The
// launch post (2026-11-12) was written in the editor, so its row still held
// the "# Launch Post" it was created with, and that is all the public page
// showed.

/** One row of docs.documents, as these queries read it. */
interface Row {
  id: string;
  title: string;
  content: string | null;
  position: number;
  tab_group_id: string;
  public_slug: string | null;
  published_at: string | null;
  updated_at: string;
  owner_id: string;
}

const rows: Row[] = [];
const crdt = new Map<string, Uint8Array>();

/** Just enough of the query builder for getPublishedDoc and the tab listing. */
function query(table: Row[]) {
  let found = [...table];
  let pendingPatch: Partial<Row> | null = null;
  const q = {
    select: () => q,
    update: (patch: Partial<Row>) => {
      pendingPatch = patch;
      return q;
    },
    eq: (col: keyof Row, value: string) => {
      found = found.filter((r) => r[col] === value);
      if (pendingPatch) for (const r of found) Object.assign(r, pendingPatch);
      return pendingPatch ? Object.assign(Promise.resolve({ data: null, error: null }), q) : q;
    },
    not: (col: keyof Row) => {
      found = found.filter((r) => r[col] !== null);
      return q;
    },
    order: () => Promise.resolve({ data: found.sort((a, b) => a.position - b.position), error: null }),
    maybeSingle: () => Promise.resolve({ data: found[0] ?? null, error: null }),
  };
  return q;
}

vi.mock("@markbase/protocol/supabase", () => ({
  supabase: { schema: () => ({ from: () => query(rows) }) },
}));
vi.mock("../src/server/crdt-store", () => ({
  loadCrdtSnapshot: async (id: string) => (crdt.has(id) ? { state: crdt.get(id)!, version: 1 } : null),
  // The store as the publish path uses it: the saved state becomes the document's.
  saveCrdtSnapshot: async (id: string, incoming: Uint8Array) => {
    crdt.set(id, incoming);
    return { changed: true, state: incoming, version: 2 };
  },
  broadcastCrdt: async () => {},
}));
// The searchable mirror is not what these tests are about.
vi.mock("../src/server/documents", async (original) => ({
  ...(await original<typeof import("../src/server/documents")>()),
  mirrorDocContent: async () => {},
  getDocument: async (id: string) => rows.find((r) => r.id === id) ?? null,
}));

function row(over: Partial<Row>): Row {
  return {
    id: "d1",
    title: "Launch Post",
    content: "# Launch Post\n",
    position: 0,
    tab_group_id: "g1",
    public_slug: "launch-post-d1",
    published_at: "2026-11-12T00:00:00Z",
    updated_at: "2026-11-12T00:00:00Z",
    owner_id: "u1",
    ...over,
  };
}

function crdtOf(markdown: string): Uint8Array {
  const doc = createDoc("");
  setMarkdown(doc, markdown, "editor");
  return snapshot(doc);
}

beforeEach(() => {
  rows.length = 0;
  crdt.clear();
});

describe("getPublishedTabs", () => {
  it("publishes what was written in the editor, not the row's stale content", async () => {
    const { getPublishedTabs } = await import("../src/server/publish");
    rows.push(row({}));
    crdt.set("d1", crdtOf("# Launch Post\n\nToday we are opening Markbase.\n"));

    const data = await getPublishedTabs("launch-post-d1");
    expect(data?.tabs).toHaveLength(1);
    expect(data?.tabs[0].content).toContain("Today we are opening Markbase.");
  });

  it("falls back to the row for a document that has no CRDT yet", async () => {
    const { getPublishedTabs } = await import("../src/server/publish");
    rows.push(row({ content: "# Launch Post\n\nWritten through the API.\n" }));

    const data = await getPublishedTabs("launch-post-d1");
    expect(data?.tabs[0].content).toContain("Written through the API.");
  });

  it("reads every tab of the group from its own CRDT, in order", async () => {
    const { getPublishedTabs } = await import("../src/server/publish");
    rows.push(row({}), row({ id: "d2", title: "FAQ", content: "", position: 1, public_slug: null, published_at: null }));
    crdt.set("d1", crdtOf("first tab\n"));
    crdt.set("d2", crdtOf("second tab\n"));

    const data = await getPublishedTabs("launch-post-d1");
    expect(data?.tabs.map((t) => t.content.trim())).toEqual(["first tab", "second tab"]);
  });

  it("is null for a slug that is not published", async () => {
    const { getPublishedTabs } = await import("../src/server/publish");
    rows.push(row({ published_at: null }));
    expect(await getPublishedTabs("launch-post-d1")).toBeNull();
  });
});

describe("publishing pins a version", () => {
  it("publishes the text as it stands and keeps showing it after more edits", async () => {
    const { getPublishedTabs, publishDocument, publishVersions } = await import("../src/server/publish");
    rows.push(row({ published_at: null, public_slug: null }));
    crdt.set("d1", crdtOf("# Launch Post\n\nReady to ship.\n"));

    const { slug, version } = await publishDocument("d1");
    expect(version).toBe(0);

    // The author keeps writing; the public page does not move.
    const { restore, snapshot: snap } = await import("../src/logic/sync");
    const live = restore(crdt.get("d1")!);
    setMarkdown(live, "# Launch Post\n\nReady to ship. And a half-finished thought\n", "editor");
    crdt.set("d1", snap(live));

    const data = await getPublishedTabs(slug);
    expect(data?.tabs[0].content).toBe("# Launch Post\n\nReady to ship.\n");
    const state = await publishVersions("d1", null);
    expect(state).toMatchObject({ version: 0, behind: true });
    expect(state.versions).toHaveLength(1);

    // Publishing again takes the latest text as a new version.
    const again = await publishDocument("d1");
    expect(again.version).toBe(1);
    expect((await getPublishedTabs(slug))?.tabs[0].content).toContain("half-finished thought");
    expect(await publishVersions("d1", null)).toMatchObject({ version: 1, behind: false });

    // And an older version can be chosen back.
    await publishDocument("d1", 0);
    expect((await getPublishedTabs(slug))?.tabs[0].content).toBe("# Launch Post\n\nReady to ship.\n");
    await expect(publishDocument("d1", 7)).rejects.toThrow();
  });
});
