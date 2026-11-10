// How a version says who wrote it.
//
// Three writers edit the same Y.Doc — the browser editor, the agent HTTP API,
// and the vault daemon — and until now the recorded author was either missing or
// an email address. Neither answers what a history list is actually asked: WHO
// did this, and when it was an agent, WHOSE agent.
//
// "Jessie's Claude Code" needs two facts that live apart: the owner (a Supabase
// auth user) and the tool (api_keys.provider, stamped from the MCP handshake's
// X-MCP-Client header). This module is only the join — resolving either input is
// the caller's job, because one is an admin lookup and the other an API round
// trip, and folding those in here would make the labelling untestable.

import type { Provider } from "./agent-sessions";

/** When we know nothing about a person. Better than an empty possessive. */
const SOMEONE = "Someone";

const clean = (s: string | null | undefined): string => (s ?? "").trim();

/**
 * A person's display name.
 *
 * Supabase auth metadata carries `full_name` for OAuth sign-ins but often
 * nothing for email/password ones, and this codebase has no profiles table — so
 * without a fallback a user would be attributed by full email address. That
 * string then replicates inside the Y.Doc to everyone the document is shared
 * with, guests included, which is a worse default than a local part.
 */
export function personName(user: { name: string | null; email: string | null }): string {
  const name = clean(user.name);
  if (name) return name;

  const email = clean(user.email);
  if (!email) return SOMEONE;
  // A value with no "@" is not an address; using it whole is the honest reading.
  const local = email.includes("@") ? email.slice(0, email.indexOf("@")) : email;
  return local || SOMEONE;
}

/**
 * What to call the tool behind a connection, as its users would recognise it.
 *
 * `null` for "unknown" — that is the database default for every key minted
 * before provider stamping, and the value a plain bearer token keeps forever
 * because it never sends X-MCP-Client. Naming a tool there would invent one.
 */
export function toolName(provider: Provider): string | null {
  switch (provider) {
    case "claude_code":
      return "Claude Code";
    case "claude_desktop":
      return "Claude Desktop";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "unknown":
      return null;
  }
}

/**
 * Label an agent's edit: the owner, then the tool.
 *
 * Deliberately NOT falling back to the connection's stored name. Unknown-provider
 * keys are precisely the old ones, whose names were built from the approving
 * BROWSER's User-Agent ("markbase CLI · 2026-07-10 · Mozilla/5.0 (Macintosh…"),
 * so surfacing the stored name would print that string into the history list.
 * "Jessie's agent" says exactly as much as we actually know.
 *
 * One possessive rule for everyone, including names ending in "s": making the
 * label depend on spelling invites a style argument, and "Chris' Claude Code"
 * reads as a typo to most people.
 */
export function agentLabel(ownerName: string, provider: Provider): string {
  const owner = clean(ownerName) || SOMEONE;
  return `${owner}'s ${toolName(provider) ?? "agent"}`;
}
