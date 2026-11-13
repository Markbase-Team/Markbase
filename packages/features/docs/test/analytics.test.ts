import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { setMarkdown } from "../src/logic/crdt";
import { appendVersion } from "../src/logic/versions";
import { addAgentReads, lineCredit, listAgentReads, writerText } from "../src/logic/analytics";

// A document's analytics: the agents' read tally, and who wrote each line —
// a person, an agent, and whose agent. The line credit is worked out from the
// versions, so these build a history and ask who wrote what is left.

function docWith(versions: { text: string; author?: string; agents?: string[]; mixed?: boolean }[]): Y.Doc {
  const doc = new Y.Doc();
  for (const v of versions) {
    setMarkdown(doc, v.text);
    appendVersion(doc, v.text, { author: v.author, agents: v.agents, mixed: v.mixed });
  }
  return doc;
}

describe("agent reads", () => {
  it("tallies reads by agent and by whose agent it is", () => {
    const doc = new Y.Doc();
    addAgentReads(doc, [{ agent: "claude", owner: "Jessie", count: 2, lastAt: 100 }]);
    addAgentReads(doc, [
      { agent: "claude", owner: "Jessie", count: 1, lastAt: 300 },
      { agent: "claude", owner: "Sam", count: 1, lastAt: 200 },
      { agent: "codex", owner: "Jessie", count: 5, lastAt: 50 },
    ]);
    expect(listAgentReads(doc)).toEqual([
      { agent: "codex", owner: "Jessie", count: 5, lastAt: 50 },
      { agent: "claude", owner: "Jessie", count: 3, lastAt: 300 },
      { agent: "claude", owner: "Sam", count: 1, lastAt: 200 },
    ]);
  });

  it("reaches another replica of the document", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addAgentReads(a, [{ agent: "cursor", owner: null, count: 1, lastAt: 1 }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(listAgentReads(b)).toEqual([{ agent: "cursor", owner: null, count: 1, lastAt: 1 }]);
  });
});

describe("lineCredit", () => {
  it("credits each line to whoever wrote the version it came in", () => {
    const doc = docWith([
      { text: "# Plan\n\nShip on Monday.\n", author: "Jessie" },
      { text: "# Plan\n\nShip on Monday.\n\nRisks: none known.\nOwner: Sam.\n", author: "Jessie", agents: ["claude"] },
    ]);
    const credit = lineCredit(doc);
    expect(credit.lines).toBe(4);
    expect(credit.ranges.map((r) => [r.from, r.to, writerText(r.writer), r.preview])).toEqual([
      [1, 3, "Jessie", "# Plan"],
      // The blank line before its paragraph came in with the agent's version.
      [4, 6, "Claude Code · Jessie’s", "Risks: none known."],
    ]);
    expect(credit.shares.map((s) => [writerText(s.writer), s.lines])).toEqual([
      ["Jessie", 2],
      ["Claude Code · Jessie’s", 2],
    ]);
  });

  it("gives a rewritten line to whoever rewrote it, and keeps the rest", () => {
    const doc = docWith([
      { text: "one\ntwo\nthree\n", author: "Jessie" },
      { text: "one\nTWO\nthree\n", author: "Sam", agents: ["codex"] },
    ]);
    expect(lineCredit(doc).ranges.map((r) => [r.from, r.to, writerText(r.writer)])).toEqual([
      [1, 1, "Jessie"],
      [2, 2, "Codex · Sam’s"],
      [3, 3, "Jessie"],
    ]);
  });

  it("keeps a last line's writer when someone only writes below it", () => {
    // The agent left no newline at the end; the person's addition supplies one.
    const doc = docWith([
      { text: "one\nby the agent", author: "Jessie", agents: ["claude"] },
      { text: "one\nby the agent\nby the person\n", author: "Jessie" },
    ]);
    expect(lineCredit(doc).ranges.map((r) => [r.from, r.to, writerText(r.writer)])).toEqual([
      [1, 2, "Claude Code · Jessie’s"],
      [3, 3, "Jessie"],
    ]);
  });

  it("tells whose agent it was when two people's agents wrote", () => {
    const doc = docWith([
      { text: "a\n", author: "Jessie", agents: ["claude"] },
      { text: "a\nb\n", author: "Sam", agents: ["claude"] },
    ]);
    expect(lineCredit(doc).shares.map((s) => writerText(s.writer)).sort()).toEqual([
      "Claude Code · Jessie’s",
      "Claude Code · Sam’s",
    ]);
  });

  it("says so for a version that held both a person's edits and an agent's", () => {
    const doc = docWith([{ text: "a\nb\n", author: "Jessie", agents: ["cursor"], mixed: true }]);
    const [share] = lineCredit(doc).shares;
    expect(share.writer.kind).toBe("mixed");
    expect(writerText(share.writer)).toBe("Jessie + Cursor");
  });

  it("marks text newer than the last version as not recorded yet", () => {
    const doc = docWith([{ text: "kept\n", author: "Jessie" }]);
    setMarkdown(doc, "kept\njust typed\n");
    expect(lineCredit(doc).ranges.map((r) => [r.from, writerText(r.writer)])).toEqual([
      [1, "Jessie"],
      [2, "Not recorded yet"],
    ]);
  });

  it("has nothing to say about an empty document", () => {
    expect(lineCredit(new Y.Doc())).toEqual({ ranges: [], shares: [], lines: 0 });
  });
});
