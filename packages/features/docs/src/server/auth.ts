import type { Author } from "@markbase/shared/docs/types";

// Capability model. Authorization is per-doc and capability-based, NOT a global
// role — a "normal user" who can edit simply holds an `editor` grant. Pure
// resolution lives here (no DB) so it's trivially testable; the DB lookups that
// feed it live in members.ts / links.ts.

import type { Capability } from "@markbase/shared/docs/capability";

export type { Capability };

const RANK: Record<Capability, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

/** True when `have` meets or exceeds `need` (e.g. editor satisfies commenter). */
export function atLeast(have: Capability | null, need: Capability): boolean {
  return have !== null && RANK[have] >= RANK[need];
}

/** An authenticated/guest actor making a request. Agents carry the userId of
 *  their API key's owner and resolve exactly as that user would — unless the key
 *  carries a `capabilityCap`, which lowers what that agent may do. */
export type Actor = Author & {
  capabilityCap?: Capability | null;
  /**
   * For an agent that named no session: whose it is and which tool, apart, so
   * a version can record the two the way an agent's hook does ("claude", and
   * the person). `tool` is null when the request did not say.
   */
  agent?: { owner: string; tool: string | null };
};

/** An actor with an account behind it — a person, or an agent on its owner's key. Never a guest. */
export type SignedInActor = Extract<Actor, { kind: "user" | "agent" }>;

/** The lower of two capabilities (a ceiling never raises access). */
export function minCapability(a: Capability, b: Capability): Capability {
  return RANK[a] <= RANK[b] ? a : b;
}

/**
 * Resolve an actor's capability on a doc from the pieces the API has gathered:
 * the doc's owner, the actor's member grant (or null), and a guest capability
 * (from a guest link, or null). Owner beats any grant; guests only ever get
 * what their link allows.
 */
export function capabilityFor(input: {
  ownerId: string;
  actor: Actor;
  memberCapability: Capability | null;
  guestCapability: Capability | null;
}): Capability | null {
  const { ownerId, actor, memberCapability, guestCapability } = input;
  let cap: Capability | null;
  if (actor.kind === "guest") cap = guestCapability;
  else if (actor.userId && actor.userId === ownerId) cap = "owner";
  else cap = memberCapability;
  // An agent key can carry a capability ceiling — cap the result, never raise it.
  if (cap !== null && actor.capabilityCap) {
    cap = minCapability(cap, actor.capabilityCap);
  }
  return cap;
}

/**
 * Who wrote a file the sync daemon found in a vault folder, as the daemon
 * knows it from the agents' hooks (`markbase write-audit`): `agent` is the
 * tool its hook named ("claude", "codex", "cursor"), or null when no hook
 * recorded the write, which makes it the person's own.
 */
export interface FileWriter {
  agent: string | null;
}

/** The names an agent's hook records itself under. */
const AGENT_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

/** A `written_by` field from a request body, or null when it is absent or not one. */
export function fileWriterOf(value: { agent?: string | null } | null | undefined): FileWriter | null {
  if (typeof value !== "object" || value === null) return null;
  const agent = value.agent;
  if (agent === null || agent === undefined) return { agent: null };
  return typeof agent === "string" && AGENT_NAME.test(agent) ? { agent } : null;
}

/**
 * Who a document adopted from a vault folder was written by, for its first
 * version.
 *
 * The request comes from the sync daemon on the owner's key, so the caller is
 * an "agent" — but the daemon only carried the file; it did not write it.
 * Without this, every file that appears in a vault, typed in Obsidian or
 * written by Claude, was created by "Jessie's agent". The daemon credits the
 * edits it syncs the same way (the hook's agent, else the person), so the
 * creation now agrees with the versions after it.
 *
 * Only an API-key caller's word is taken, and only about its own owner: a
 * signed-in browser does not adopt files, and the writer named is always
 * someone acting for the key's owner.
 */
export function adoptedFileActor(caller: SignedInActor, writer: FileWriter, ownerName: string): Actor {
  if (caller.kind !== "agent") return caller;
  if (writer.agent === null) return { kind: "user", userId: caller.userId, name: ownerName };
  return { ...caller, agent: { owner: ownerName, tool: writer.agent } };
}
