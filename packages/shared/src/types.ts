export const TICKET_STATUSES = [
  "requested",
  "ready_to_execute",
  "in_progress",
  "review_requested",
  "done",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

// A ticket's assignee is either the app owner themself ("user") or one of their
// named agent sessions ("agent", identified by Ticket.agent_session_id ->
// agent_sessions.id). Agent-owned tickets are the ones the Claude Code worker runs.
export const OWNER_KINDS = ["user", "agent"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export function isOwnerKind(v: string | null | undefined): v is OwnerKind {
  return v === "user" || v === "agent";
}

// State of a Claude Code session dispatched for a ticket.
// "queued" = enqueued for the local worker; "running" = worker is executing.
export type CcState = "idle" | "queued" | "running" | "done" | "error";

// A commit reported by a Claude Code session.
export interface TicketCommit {
  title: string;
  link: string | null;
  at?: string;
}

// A property/value field defined on a project. Every ticket in the project
// inherits the property; its value (held on the ticket) may be unset. When
// `options` is non-empty the value must be one of them; otherwise it's free text.
export interface ProjectProperty {
  id: string;
  project: string;
  name: string;
  options: string[];
  /** Pre-filled onto new tickets when set. Empty string = no default. */
  default_value: string;
  position: number;
  created_at: string;
}

export interface Ticket {
  id: string;
  project: string;
  /** The auth user who owns this ticket (inherited from its project). Distinct
   * from the assignee below. */
  owner_id: string | null;
  title: string;
  description: string;
  requester: string;
  /** The assignee: the app owner ("user") or one of their agents ("agent"). */
  owner_kind: OwnerKind;
  /** When owner_kind is "agent", the named agent session assigned to this ticket
   * (agent_sessions.id) — the work continues in that session's thread. Null means
   * an unspecified agent (e.g. a legacy ticket), and always null for "user". */
  agent_session_id: string | null;
  status: TicketStatus;
  images: string[];
  /** Per-property values, keyed by ProjectProperty.id. Missing => unset. */
  properties: Record<string, string>;
  /** Branch the worker bases its work on / targets the PR against. */
  base_branch: string | null;
  /** When true, the session commits after each change and opens/updates a PR;
   * when false it leaves changes uncommitted for review. */
  auto_commit: boolean;
  cc_state: CcState;
  cc_session_id: string | null;
  /** A Claude session the user picked to resume on dispatch (else null/fresh). */
  cc_seed_session_id: string | null;
  cc_summary: string | null;
  cc_last_run: string | null;
  cc_branch: string | null;
  commits: TicketCommit[];
  pr_title: string | null;
  pr_id: string | null;
  pr_url: string | null;
  preview_url: string | null;
  created_at: string;
  updated_at: string;
}

// One MCP server in a project's config — the standard Claude Code shape.
// Credentials are written as ${SECRET_NAME} references in env/headers/args; the
// values live in the worker's local secret store and are injected as env at run
// time (so the stored config holds no secrets).
export interface McpServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface Project {
  slug: string;
  name: string;
  github_repo: string | null;
  local_path: string | null;
  /** The auth user who owns this project; scopes all its tickets/logs/etc. */
  owner_id: string | null;
  /** Names of the people who own this project (admin-managed, free text). */
  owners: string[];
  /** Per-project MCP servers for Claude Code runs (with ${SECRET} refs). */
  mcp_config: McpConfig | null;
  created_at: string;
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  requested: "Requested",
  ready_to_execute: "Ready to execute",
  in_progress: "In progress",
  review_requested: "Review requested",
  done: "Done",
};

export function isStatus(
  v: string | null | undefined
): v is TicketStatus {
  return typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v);
}

// Normalize a list of names (e.g. project owners) given either a comma-separated
// string or an array: trim each, drop blanks, de-dupe (first wins). Shared by
// the data layer, the API, and the admin form.
export function cleanNameList(
  input: string | string[] | null | undefined
): string[] {
  if (input == null) return [];
  const parts = Array.isArray(input) ? input : input.split(",");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const v = typeof part === "string" ? part.trim() : "";
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
