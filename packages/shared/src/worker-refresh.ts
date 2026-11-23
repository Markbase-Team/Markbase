// What the web server asks a worker to look up, and what the worker answers.
//
// The web server has no checkout: a project's repo is on the machine its
// worker runs on. So anything that needs git, gh or the Vercel CLI in that
// repo is the worker's to run. The server records a request, the worker sees
// it on its next idle claim (ClaimResult.refresh), runs the lookup in the
// project's local path and posts the answer back. Nothing here is live: an
// answer is as fresh as the worker's last report.
//
// Two things can be asked for:
//   a ticket   its commits, open PR, review request and preview URL
//   a project  its branches and origin remote

import type { TicketCommit } from "./types";

export type RefreshKind = "ticket" | "project";

/** Pending requests for one owner: ticket ids and project slugs. */
export interface RefreshRequests {
  tickets: string[];
  projects: string[];
}

/** How long a request waits for a worker before the server stops offering it. */
export const REFRESH_REQUEST_TTL_MS = 10 * 60_000;

/** A repo's branches, as a new ticket's base-branch picker shows them. */
export interface ProjectBranches {
  /** Unique branch names (local + origin), default/current first. */
  branches: string[];
  /** The repo's default branch (origin/HEAD target), if detectable. */
  default: string | null;
  /** The currently checked-out branch, if any. */
  current: string | null;
}

/** What a worker reports about a project's local repo. */
export interface ProjectRepoReport extends ProjectBranches {
  /** The origin remote URL, or null when the repo has none. */
  remote: string | null;
}

/** The branches stored on a project, with when the worker reported them. */
export interface StoredProjectBranches extends ProjectBranches {
  at: string;
}

/** What a worker reports about a ticket's branch. */
export interface TicketSyncReport {
  commits: TicketCommit[];
  pr_id: string | null;
  pr_title: string | null;
  pr_url: string | null;
  /** True when the open PR has a pending review request; null with no open PR. */
  review_requested: boolean | null;
  preview_url: string | null;
}

export interface ProjectRepoReportBody {
  branches?: string[];
  default?: string | null;
  current?: string | null;
  remote?: string | null;
}

const stringOrNull = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Validate a worker's project report; null when it is not one. */
export function projectRepoReportFrom(body: ProjectRepoReportBody): ProjectRepoReport | null {
  if (!Array.isArray(body.branches)) return null;
  const branches = [
    ...new Set(
      body.branches
        .filter((b): b is string => typeof b === "string")
        .map((b) => b.trim())
        .filter(Boolean)
    ),
  ].slice(0, 500);
  return {
    branches,
    default: stringOrNull(body.default),
    current: stringOrNull(body.current),
    remote: stringOrNull(body.remote),
  };
}

export interface TicketSyncReportBody {
  commits?: Array<{ title?: string; link?: string | null; at?: string }>;
  pr_id?: string | null;
  pr_title?: string | null;
  pr_url?: string | null;
  review_requested?: boolean | null;
  preview_url?: string | null;
}

/** Validate a worker's ticket report. Missing fields read as "nothing found". */
export function ticketSyncReportFrom(body: TicketSyncReportBody): TicketSyncReport {
  const commits: TicketCommit[] = Array.isArray(body.commits)
    ? body.commits
        .filter(
          (c): c is { title: string; link?: string | null; at?: string } =>
            !!c && typeof c === "object" && typeof c.title === "string"
        )
        .map((c) => ({
          title: c.title,
          link: typeof c.link === "string" ? c.link : null,
          ...(typeof c.at === "string" ? { at: c.at } : {}),
        }))
    : [];
  return {
    commits,
    pr_id: stringOrNull(body.pr_id),
    pr_title: stringOrNull(body.pr_title),
    pr_url: stringOrNull(body.pr_url),
    review_requested: typeof body.review_requested === "boolean" ? body.review_requested : null,
    preview_url: stringOrNull(body.preview_url),
  };
}
