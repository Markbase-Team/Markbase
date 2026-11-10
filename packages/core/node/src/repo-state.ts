import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TicketCommit } from "@markbase/protocol/types";

const exec = promisify(execFile);

export interface RepoState {
  commits: TicketCommit[];
  pr_title: string | null;
  pr_id: string | null;
  pr_url: string | null;
  /**
   * Whether a review has been requested on the open PR. True when GitHub lists
   * pending review requests (you asked someone to review) or the PR's review
   * decision is REVIEW_REQUIRED. Null when there is no open PR to inspect.
   */
  review_requested: boolean | null;
}

// One requested reviewer as returned by `gh pr --json reviewRequests`. A user
// carries `login`; a team carries `name`. We only need to know the list is
// non-empty, but the shape keeps the parse honest.
interface ReviewRequest {
  login?: string;
  name?: string;
}

// Re-derive a ticket's commits and open PR directly from the repo (git + gh),
// so the board reflects work done in a session even if the agent didn't report
// it to /progress. Best-effort: returns null on failure.
export async function getRepoState(
  cwd: string,
  branch: string
): Promise<RepoState | null> {
  const gh = (args: string[]) =>
    exec("gh", args, { cwd, timeout: 20_000 }).then((r) => r.stdout.trim());
  const git = (args: string[]) =>
    exec("git", args, { cwd, timeout: 20_000 }).then((r) => r.stdout.trim());

  try {
    const repo = await gh([
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "-q",
      ".nameWithOwner",
    ]).catch(() => "");

    let base = "main";
    try {
      base =
        (await gh([
          "repo",
          "view",
          "--json",
          "defaultBranchRef",
          "-q",
          ".defaultBranchRef.name",
        ])) || "main";
    } catch {
      // keep "main"
    }

    // Commits on `branch` not on the base branch, oldest first.
    // Format: "<sha> <subject>" — the sha has no spaces, so split on the first.
    const log = await git([
      "log",
      "--reverse",
      "--pretty=%H %s",
      `${base}..${branch}`,
    ]).catch(() => "");
    const commits: TicketCommit[] = log
      ? log
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const sp = line.indexOf(" ");
            const sha = sp === -1 ? line : line.slice(0, sp);
            const title = sp === -1 ? "" : line.slice(sp + 1);
            return {
              title,
              link: repo ? `https://github.com/${repo}/commit/${sha}` : null,
            };
          })
      : [];

    let pr_title: string | null = null;
    let pr_id: string | null = null;
    let pr_url: string | null = null;
    let review_requested: boolean | null = null;
    try {
      const prJson = await gh([
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "number,title,url,reviewRequests,reviewDecision",
        "-q",
        ".[0] // empty",
      ]);
      if (prJson) {
        const pr: {
          number: number;
          title?: string;
          url?: string;
          reviewRequests?: ReviewRequest[];
          reviewDecision?: string;
        } = JSON.parse(prJson);
        pr_id = String(pr.number);
        pr_title = pr.title ?? null;
        pr_url = pr.url ?? null;
        // A review has been requested when GitHub lists pending reviewers, or
        // the PR still requires a review (reviewDecision === REVIEW_REQUIRED).
        review_requested =
          (pr.reviewRequests?.length ?? 0) > 0 ||
          pr.reviewDecision === "REVIEW_REQUIRED";
      }
    } catch {
      // no PR / gh failure
    }

    return { commits, pr_title, pr_id, pr_url, review_requested };
  } catch {
    return null;
  }
}
