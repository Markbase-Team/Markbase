import { describe, it, expect } from "vitest";
import { projectRepoReportFrom, ticketSyncReportFrom } from "../src/worker-refresh";
import { normalizeRemote } from "../src/git-remote";
import { WorkerApi } from "../src/worker-api";

// A worker's report is what gets written onto a ticket or a project, so what
// counts as one is decided here rather than trusted from the wire.

describe("projectRepoReportFrom", () => {
  it("keeps real branch names once each, in the order given", () => {
    expect(
      projectRepoReportFrom({
        branches: ["main", " dev ", "main", ""],
        default: "main",
        current: " ",
        remote: "git@github.com:o/r.git",
      })
    ).toEqual({
      branches: ["main", "dev"],
      default: "main",
      current: null,
      remote: "git@github.com:o/r.git",
    });
  });

  it("is not a report without a branch list", () => {
    expect(projectRepoReportFrom({ remote: "x" })).toBeNull();
  });
});

describe("ticketSyncReportFrom", () => {
  it("reads a missing field as nothing found", () => {
    expect(ticketSyncReportFrom({})).toEqual({
      commits: [],
      pr_id: null,
      pr_title: null,
      pr_url: null,
      review_requested: null,
      preview_url: null,
    });
  });

  it("drops commits without a title and keeps the rest", () => {
    const report = ticketSyncReportFrom({
      commits: [{ title: "one", link: "https://x/1" }, { link: "https://x/2" }, { title: "three" }],
      review_requested: false,
    });
    expect(report.commits).toEqual([
      { title: "one", link: "https://x/1" },
      { title: "three", link: null },
    ]);
    expect(report.review_requested).toBe(false);
  });
});

describe("normalizeRemote", () => {
  it("turns the forms people type and git reports into one URL", () => {
    expect(normalizeRemote("acme/widgets")).toBe("https://github.com/acme/widgets");
    expect(normalizeRemote("git@github.com:acme/widgets.git")).toBe("https://github.com/acme/widgets");
    expect(normalizeRemote("https://github.com/acme/widgets.git")).toBe("https://github.com/acme/widgets");
    expect(normalizeRemote("not a repo")).toBeNull();
  });
});

describe("WorkerApi refresh answers", () => {
  it("posts each answer to its own worker endpoint", async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const doFetch: typeof globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const api = new WorkerApi("https://markbase.so", "jsk_test_key", { fetch: doFetch });
    await api.reportProjectRepo("a b", { branches: ["main"], default: "main", current: "main", remote: null });
    await api.reportTicketSync("t1", {
      commits: [],
      pr_id: null,
      pr_title: null,
      pr_url: null,
      review_requested: null,
      preview_url: null,
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://markbase.so/api/v1/worker/projects/a%20b/repo",
      "POST https://markbase.so/api/v1/worker/tickets/t1/sync",
    ]);
    expect(JSON.parse(calls[0].body).branches).toEqual(["main"]);
  });
});
