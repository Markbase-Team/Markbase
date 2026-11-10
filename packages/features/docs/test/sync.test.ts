import { describe, it, expect } from "vitest";
import { createDoc, getMarkdown, setMarkdown } from "../src/logic/crdt";
import {
  snapshot,
  restore,
  stateVector,
  diffSince,
  mergeUpdates,
  applyRemote,
} from "../src/logic/sync";

describe("sync: persistence (snapshot/restore for the DB)", () => {
  it("round-trips content, images included", () => {
    const doc = createDoc("# Persisted\n\n![img](x.png)\n\n> quote\n");
    const blob = snapshot(doc);
    const back = restore(blob);
    expect(getMarkdown(back)).toBe("# Persisted\n\n![img](x.png)\n\n> quote\n");
  });
});

describe("sync: incremental delta (minimal, not the whole doc)", () => {
  it("diffSince a peer's state vector brings it up to date and stays small", () => {
    const server = createDoc("line\n".repeat(500)); // big doc
    const client = restore(snapshot(server)); // client is caught up
    const csv = stateVector(client);
    setMarkdown(server, "line\n".repeat(500) + "one new line\n"); // tiny change
    const delta = diffSince(server, csv);
    expect(delta.length).toBeLessThan(200); // proportional to the change, not the doc
    applyRemote(client, delta);
    expect(getMarkdown(client)).toBe(getMarkdown(server)); // converged
  });
});

describe("sync: update-log compaction", () => {
  it("merging a log of updates equals applying them one by one", () => {
    const a = createDoc("v0\n");
    const base = snapshot(a); // shared starting point (same item identity)
    const updates: Uint8Array[] = [];
    let sv = stateVector(a);
    for (const line of ["a", "b", "c"]) {
      setMarkdown(a, getMarkdown(a) + line + "\n");
      updates.push(diffSince(a, sv));
      sv = stateVector(a);
    }
    const rebuilt = restore(base);
    applyRemote(rebuilt, mergeUpdates(updates)); // one compacted update
    expect(getMarkdown(rebuilt)).toBe(getMarkdown(a));
  });
});

describe("sync: two-way protocol converges", () => {
  it("A and B reconcile via state-vector exchange", () => {
    const A = createDoc("shared\n");
    const B = restore(snapshot(A));
    setMarkdown(A, "shared\nfrom A\n", "A");
    setMarkdown(B, "shared\nfrom B\n", "B");
    const toB = diffSince(A, stateVector(B));
    const toA = diffSince(B, stateVector(A));
    applyRemote(A, toA);
    applyRemote(B, toB);
    expect(getMarkdown(A)).toBe(getMarkdown(B));
    expect(getMarkdown(A)).toContain("from A");
    expect(getMarkdown(A)).toContain("from B");
  });
});
