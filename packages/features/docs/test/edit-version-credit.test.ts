import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { setMarkdown } from "../src/logic/crdt";
import { checkpoint } from "../src/logic/versions";
import { lineCredit, writerText } from "../src/logic/analytics";
import { versionCredit } from "../src/handlers/editing";

// An edit made through the API is credited to whoever made it: an agent's edit
// as an agent's, so history and "Who wrote it" show it as one.

describe("versionCredit", () => {
  it("credits an agent's edit as an agent's", () => {
    expect(versionCredit({ kind: "agent", name: "Jessie's Claude Code" })).toEqual({
      agents: ["Jessie's Claude Code"],
    });
  });

  it("credits a person's edit to the person", () => {
    expect(versionCredit({ kind: "user", name: "Jessie" })).toEqual({ author: "Jessie" });
  });

  it("makes the agent's lines read as an agent's in Who wrote it", () => {
    const doc = new Y.Doc();
    setMarkdown(doc, "a\nb\n");
    checkpoint(doc, versionCredit({ kind: "agent", name: "Jessie's agent" }));
    const [share] = lineCredit(doc).shares;
    expect([share.writer.kind, writerText(share.writer)]).toEqual(["agent", "Jessie's agent"]);
  });
});
