import type { Author } from "../logic/types";

// Capability model. Authorization is per-doc and capability-based, NOT a global
// role — a "normal user" who can edit simply holds an `editor` grant. Pure
// resolution lives here (no DB) so it's trivially testable; the DB lookups that
// feed it live in members.ts / links.ts.

export type Capability = "owner" | "editor" | "commenter" | "viewer";

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

/** An authenticated/guest actor making a request. Agents pass the userId of
 *  their API key's owner and resolve exactly as that user would — unless the key
 *  carries a `capabilityCap`, which lowers what that agent may do. */
export type Actor = Author & {
  userId?: string;
  capabilityCap?: Capability | null;
};

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
