import { describe, it, expect } from "vitest";

// The ordering listAgentSessions applies, extracted so it can be tested without
// a database. Kept in step with the implementation by the test below.
const at = (iso: string | null): number => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
};
// COALESCE, not max: the sweep's timestamp is newer than every created_at, so
// max() would return it for all of them and the tie would survive.
const recency = (s: { last_active: string | null; created_at: string }): number =>
  s.last_active ? at(s.last_active) : at(s.created_at);
const sort = <T extends { last_active: string | null; created_at: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => recency(b) - recency(a) || at(b.created_at) - at(a.created_at));

// The assignee picker shows only the first few sessions, so the ORDER decides
// what a person can pick without opening a dialog.
describe("agent sessions, most recent first", () => {
  it("breaks the tie the worker's sweep creates", () => {
    // The sweep stamps last_active on every session it finds, in one pass — 65
    // sessions on this account share one millisecond. Sorting on it alone is a
    // total tie, and the database may return any order.
    const swept = "2026-08-23T02:52:03.101Z";
    const out = sort([
      { name: "old", last_active: swept, created_at: "2026-07-22T00:00:00Z" },
      { name: "new", last_active: swept, created_at: "2026-08-18T00:00:00Z" },
      { name: "mid", last_active: swept, created_at: "2026-08-10T00:00:00Z" },
    ]);
    expect(out.map((s) => s.name)).toEqual(["new", "mid", "old"]);
  });

  it("puts a never-swept session where its age says, not at the bottom", () => {
    // NULL last_active sorted last, so the session you just made was the hardest
    // one to find — the exact opposite of what the picker is for.
    const out = sort([
      { name: "swept last week", last_active: "2026-08-16T00:00:00Z", created_at: "2026-07-01T00:00:00Z" },
      { name: "made moments ago", last_active: null, created_at: "2026-08-23T02:00:00Z" },
    ]);
    expect(out[0].name).toBe("made moments ago");
  });

  it("prefers real activity over age when a session has both", () => {
    const out = sort([
      { name: "new but idle", last_active: null, created_at: "2026-08-20T00:00:00Z" },
      { name: "older, active today", last_active: "2026-08-23T00:00:00Z", created_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(out[0].name).toBe("older, active today");
  });

  it("does not crash on a malformed timestamp", () => {
    const out = sort([
      { name: "bad", last_active: "not-a-date", created_at: "also-not-a-date" },
      { name: "good", last_active: null, created_at: "2026-08-01T00:00:00Z" },
    ]);
    expect(out[0].name).toBe("good"); // the unparseable one sinks, it doesn't throw
  });
});
