// Registry of features that only work when Claude Code is installed locally.
//
// Most of Markbase is pure web: documents, and the ticket board itself — writing
// a ticket, moving it across the board, discussing it. What needs Claude Code is
// only ever the step where work is *handed to an agent*, because that step is
// the local worker driving `claude` on the user's machine.
//
// Draw the line there and nowhere wider. A tracker is useful on its own; locking
// someone out of their own board because they lack a binary would be wrong.
//
// This is the one list. A gate anywhere in the app names a FeatureId and asks
// isFeatureEnabled(); the quickstart page renders the same list back to the user
// as "here's what you unlock". Adding a Claude-Code-only feature means adding it
// here, and both sides update together.

export type FeatureId = "ticketDispatch" | "agents" | "mentionReply";

export interface Feature {
  id: FeatureId;
  name: string;
  /** Shown on the quickstart page: what this does, once unlocked. */
  blurb: string;
}

/** Every feature that needs a local Claude Code install. Order is display order. */
export const CLAUDE_CODE_FEATURES: readonly Feature[] = [
  {
    id: "ticketDispatch",
    name: "Assigning tickets to agents",
    blurb:
      "Hand a ticket to an agent and your local Claude Code picks it up, does the work in your repo, and reports back. Writing and tracking tickets works without it.",
  },
  {
    id: "agents",
    name: "Agents",
    blurb:
      "Name a Claude Code session, keep it around, and hand it work later — it resumes where it left off.",
  },
  {
    id: "mentionReply",
    name: "@mention replies",
    blurb:
      "@mention an agent in a document comment and it wakes up, reads the thread, and replies inline.",
  },
];

const BY_ID = new Map(CLAUDE_CODE_FEATURES.map((f) => [f.id, f]));

/** What the current user's machines can do. Extend as more gates appear. */
export interface FeatureEnv {
  /** Any live connection reports a `claude --version`. */
  claudeCode: boolean;
}

export function requiresClaudeCode(id: string): boolean {
  return BY_ID.has(id as FeatureId);
}

export function getFeature(id: FeatureId): Feature {
  const f = BY_ID.get(id);
  if (!f) throw new Error(`unknown feature: ${id}`);
  return f;
}

/**
 * Features outside the registry are unconditionally on — the default is
 * "available", so forgetting to register something never locks a user out of it.
 */
export function isFeatureEnabled(id: string, env: FeatureEnv): boolean {
  return requiresClaudeCode(id) ? env.claudeCode : true;
}
