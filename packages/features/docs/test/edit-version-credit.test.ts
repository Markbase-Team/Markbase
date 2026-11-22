import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { setMarkdown } from "@markbase/protocol/docs/crdt";
import { checkpoint } from "@markbase/protocol/docs/versions";
import { lineCredit, writerText } from "@markbase/protocol/docs/analytics";
import { versionCredit } from "../src/server/doc-crdt";

// An edit made through the API is credited to whoever made it: an agent's edit
// as an agent's, so history and "Who wrote it" show it as one.

describe("versionCredit", () => {
  it("credits an agent's edit as an agent's", () => {
    expect(versionCredit({ kind: "agent", userId: "u1", name: "Jessie's Claude Code" })).toEqual({
      agents: ["Jessie's Claude Code"],
    });
  });

  it("records whose agent and which tool apart, as an agent's hook does", () => {
    expect(
      versionCredit({ kind: "agent", userId: "u1", name: "Jessie's Claude", agent: { owner: "Jessie", tool: "claude" } })
    ).toEqual({ author: "Jessie", agents: ["claude"] });
    const doc = new Y.Doc();
    setMarkdown(doc, "a\n");
    checkpoint(doc, versionCredit({ kind: "agent", userId: "u1", name: "Jessie's agent", agent: { owner: "Jessie", tool: null } }));
    expect(writerText(lineCredit(doc).shares[0].writer)).toBe("Jessie's agent");
  });

  it("credits a person's edit to the person", () => {
    expect(versionCredit({ kind: "user", userId: "u1", name: "Jessie" })).toEqual({ author: "Jessie" });
  });

  it("makes the agent's lines read as an agent's in Who wrote it", () => {
    const doc = new Y.Doc();
    setMarkdown(doc, "a\nb\n");
    checkpoint(doc, versionCredit({ kind: "agent", userId: "u1", name: "Jessie's agent" }));
    const [share] = lineCredit(doc).shares;
    expect([share.writer.kind, writerText(share.writer)]).toEqual(["agent", "Jessie's agent"]);
  });
});
