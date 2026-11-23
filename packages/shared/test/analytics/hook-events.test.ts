import { describe, expect, it } from "vitest";
import { HOOK_EVENTS_MAX, HOOK_EVENTS_MAX_DOCS, parseHookEvents } from "../../src/analytics/hook-events";

// What a sync daemon may report of its machine's agent hooks: one event per
// read or write, each naming the agent, the document and when.

const DOC = "11111111-1111-4111-8111-111111111111";
const AT = 1_795_000_000_000;
const read = { kind: "read", agent: "claude", docId: DOC, at: AT };

describe("parseHookEvents", () => {
  it("takes reads and writes as they were logged", () => {
    expect(parseHookEvents({ events: [read, { ...read, kind: "write", agent: "cursor" }] })).toEqual([
      { kind: "read", agent: "claude", docId: DOC, at: AT },
      { kind: "write", agent: "cursor", docId: DOC, at: AT },
    ]);
  });

  it("refuses the whole report when any event is not one", () => {
    const bad = [
      { ...read, kind: "delete" },
      { ...read, agent: "" },
      { ...read, agent: "has space" },
      { ...read, agent: "x".repeat(41) },
      { ...read, docId: "not-a-uuid" },
      { ...read, at: 0 },
      { ...read, at: null },
    ];
    for (const e of bad) expect(parseHookEvents({ events: [read, e] }), JSON.stringify(e)).toBeNull();
  });

  it("refuses an empty report, and one over the limits", () => {
    expect(parseHookEvents({})).toBeNull();
    expect(parseHookEvents({ events: [] })).toBeNull();
    expect(parseHookEvents({ events: Array.from({ length: HOOK_EVENTS_MAX + 1 }, () => read) })).toBeNull();
    const manyDocs = Array.from({ length: HOOK_EVENTS_MAX_DOCS + 1 }, (_, i) => ({
      ...read,
      docId: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    }));
    expect(parseHookEvents({ events: manyDocs })).toBeNull();
    expect(parseHookEvents({ events: manyDocs.slice(1) })).toHaveLength(HOOK_EVENTS_MAX_DOCS);
  });
});
