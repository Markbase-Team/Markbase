import { describe, it, expect } from "vitest";
import {
  confirmsOwnChange,
  docStatus,
  lastMeaningfulChange,
  meaningOf,
  readCoreFields,
} from "../../src/docs/doc-status";
import { splitFrontmatter } from "../../src/docs/markdown";

const T = (iso: string) => Date.parse(iso);

describe("readCoreFields", () => {
  it("gives defaults when there is no front matter", () => {
    const { fields, warnings } = readCoreFields(null);
    expect(fields).toEqual({
      type: "doc",
      status: "stable",
      superseded_by: null,
      owner: null,
      audience: "both",
      covers: [],
      review_by: null,
      assignee: null,
      due: null,
      done: false,
    });
    expect(warnings).toEqual([]);
  });

  it("reads a task's assignee, due date and whether it is done", () => {
    const { frontmatter } = splitFrontmatter("---\ntype: task\nassignee: human:u1\ndue: 2026-11-28\ndone: true\n---\n\nUpdate the runbook.");
    const { fields, warnings } = readCoreFields(frontmatter);
    expect(warnings).toEqual([]);
    expect(fields.type).toBe("task");
    expect(fields.assignee).toBe("human:u1");
    expect(T(fields.due!)).toBe(T("2026-11-28T00:00:00Z"));
    expect(fields.done).toBe(true);
    expect(readCoreFields({ assignee: "agent:claude" }).fields.assignee).toBe("agent:claude");
  });

  it("reads an assignee it can't place as nobody (so the owner), and a bad due or done with a warning", () => {
    const { fields, warnings } = readCoreFields({ assignee: "jessie", due: "tomorrow", done: "yes" });
    expect(fields.assignee).toBeNull();
    expect(fields.due).toBeNull();
    expect(fields.done).toBe(false);
    expect(warnings.map((w) => w.field).sort()).toEqual(["assignee", "done", "due"]);
  });

  it("reads every core field", () => {
    const { frontmatter } = splitFrontmatter(
      [
        "---",
        "type: runbook",
        "status: deprecated",
        'superseded_by: "[[New runbook]]"',
        "owner: human:jessie",
        "audience: agent",
        "covers: src/billing/**",
        "review_by: 2026-12-31",
        "service: billing",
        "---",
        "body",
      ].join("\n"),
    );
    const { fields, warnings } = readCoreFields(frontmatter);
    expect(warnings).toEqual([]);
    expect(fields.type).toBe("runbook");
    expect(fields.status).toBe("deprecated");
    expect(fields.superseded_by).toBe("[[New runbook]]");
    expect(fields.owner).toBe("human:jessie");
    expect(fields.audience).toBe("agent");
    expect(fields.covers).toEqual(["src/billing/**"]);
    expect(T(fields.review_by!)).toBe(T("2026-12-31T00:00:00Z"));
  });

  it("keeps going on values it can't use, with a warning for each", () => {
    const { fields, warnings } = readCoreFields({
      status: "current",
      audience: "robots",
      review_by: "next week",
      superseded_by: "[[Other]]",
    });
    expect(fields.status).toBe("stable");
    expect(fields.audience).toBe("both");
    expect(fields.review_by).toBeNull();
    expect(warnings.map((w) => w.field).sort()).toEqual(["audience", "review_by", "status", "superseded_by"]);
  });

  it("never reads a confirmation from front matter, and says so", () => {
    const { warnings } = readCoreFields({ verified: [{ by: "human:jessie", at: "2026-11-01" }] });
    expect(warnings).toEqual([expect.objectContaining({ field: "verified" })]);
  });

  it("rejects a date-time without an offset", () => {
    const { fields, warnings } = readCoreFields({ review_by: "2026-12-31T10:00:00" });
    expect(fields.review_by).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});

describe("meaningful changes", () => {
  it("ignores front matter, formatting and wrapping", () => {
    const a = "---\nstatus: draft\n---\n\nThe **service** fails over.";
    const b = "---\nstatus: stable\nowner: human:a\n---\n\nThe *service*\nfails over.";
    expect(meaningOf(a)).toBe(meaningOf(b));
    expect(meaningOf(a)).not.toBe(meaningOf("The service fails back."));
  });

  it("counts a link that points somewhere else", () => {
    expect(meaningOf("See [the dashboard](https://a.example).")).not.toBe(meaningOf("See [the dashboard](https://b.example)."));
  });

  it("is the newest version that changed what the document says, with who made it", () => {
    const versions = [
      { at: 1, content: "one", author: "Jessie" },
      { at: 2, content: "two", author: "Jessie", agents: ["claude"] },
      { at: 3, content: "**two**", author: "Sam" },
      { at: 4, content: "---\nowner: human:a\n---\n\ntwo", author: "Sam" },
    ];
    expect(lastMeaningfulChange(versions)).toEqual({ index: 1, at: 2, author: "Jessie", agents: ["claude"], mixed: undefined });
    expect(lastMeaningfulChange([{ at: 5, content: "x" }])?.at).toBe(5);
    expect(lastMeaningfulChange([])).toBeNull();
  });
});

describe("confirmsOwnChange", () => {
  const byPerson = { author: "Jessie" };
  const byAgent = { author: "Jessie", agents: ["claude"] };
  const byBoth = { author: "Jessie", agents: ["claude"], mixed: true };

  it("stops a person confirming their own words", () => {
    expect(confirmsOwnChange(byPerson, { kind: "human", name: "Jessie" })).toBe(true);
    expect(confirmsOwnChange(byBoth, { kind: "human", name: "Jessie" })).toBe(true);
    expect(confirmsOwnChange(byPerson, { kind: "human", name: "Sam" })).toBe(false);
  });

  it("lets a person confirm what their agent wrote", () => {
    expect(confirmsOwnChange(byAgent, { kind: "human", name: "Jessie" })).toBe(false);
  });

  it("stops an agent confirming its own words, not another agent's", () => {
    expect(confirmsOwnChange(byAgent, { kind: "agent", tool: "claude" })).toBe(true);
    expect(confirmsOwnChange(byAgent, { kind: "agent", tool: "codex" })).toBe(false);
    expect(confirmsOwnChange(byPerson, { kind: "agent", tool: "claude" })).toBe(false);
  });
});

describe("docStatus", () => {
  const body = "# Runbook\n\nRestart the worker.";

  it("is unverified with no confirmations", () => {
    expect(docStatus(body, [{ at: T("2026-11-01T00:00:00Z"), content: body }], []).trust).toBe("unverified");
  });

  it("counts only confirmations made since the last meaningful change", () => {
    const versions = [
      { at: T("2026-11-01T00:00:00Z"), content: "# Runbook\n\nRestart the server." },
      { at: T("2026-11-20T00:00:00Z"), content: body },
    ];
    const report = docStatus(body, versions, [
      { by: "human:jessie", at: "2026-11-10T00:00:00Z" },
      { by: "agent:claude", at: "2026-11-21T00:00:00Z" },
    ]);
    expect(report.last_meaningful_change).toBe("2026-11-20T00:00:00.000Z");
    expect(report.current_confirmations.map((c) => c.by)).toEqual(["agent:claude"]);
    expect(report.trust).toBe("agent_confirmed");
  });

  it("is human_confirmed when a person confirmed the current text", () => {
    const report = docStatus(body, [{ at: T("2026-11-20T00:00:00Z"), content: body }], [
      { by: "agent:claude", at: "2026-11-21T00:00:00Z" },
      { by: "human:jessie", at: "2026-11-22T00:00:00Z" },
    ]);
    expect(report.trust).toBe("human_confirmed");
  });

  it("ignores a confirmation typed into front matter", () => {
    const md = `---\nverified:\n  - { by: human:jessie, at: 2026-11-22T00:00:00Z }\n---\n\n${body}`;
    expect(docStatus(md, [{ at: T("2026-11-20T00:00:00Z"), content: md }], []).trust).toBe("unverified");
  });

  it("needs review from review_by on", () => {
    const md = `---\nreview_by: 2026-12-01\n---\n\n${body}`;
    expect(docStatus(md, [], [], T("2026-11-30T23:59:59Z")).needs_review).toBe(false);
    expect(docStatus(md, [], [], T("2026-12-01T00:00:00Z")).needs_review).toBe(true);
  });
});
