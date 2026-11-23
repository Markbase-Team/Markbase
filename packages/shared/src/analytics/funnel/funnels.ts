// Funnels: questions asked of what happened — "of the accounts that did A, how
// many then did B, and C?" A funnel stores nothing. It is a declaration, here,
// and a query, on the server (@markbase/server/analytics/funnel/funnel-report),
// which works out any funnel the same way.
//
// A step reads a signal from one of two event logs, wherever the fact was
// already recorded, so a new funnel usually needs no new tracking:
//   - a funnel event (./events.ts): what only we care about — a modal shown,
//     a sign-up completed;
//   - a user analytics action (../user-analytics.ts): what a person or an
//     agent did to their data — a vault created, a document an agent read.
//
// Anyone may declare a funnel next to their own code — a feature for its own
// flow, the app for one that crosses features — and every funnel is listed in
// one registry.

import type { UserAnalyticsChannel } from "../user-analytics";
import type { FunnelSource } from "./events";

/**
 * A funnel event, optionally only from certain sources, or with certain props
 * ("one of" for a list).
 */
export interface EventSignal {
  event: string;
  source?: FunnelSource | readonly FunnelSource[];
  where?: Record<string, string | readonly string[]>;
}

/** A user analytics action that succeeded: one endpoint or event, or "*" for any. */
export interface ActionSignal {
  action: string;
  actor?: "person" | "agent";
  channel?: UserAnalyticsChannel;
}

export type FunnelSignal = EventSignal | ActionSignal;

export function isEventSignal(signal: FunnelSignal): signal is EventSignal {
  return "event" in signal;
}

export interface FunnelStep {
  id: string;
  label: string;
  /** Reached by whichever of these happens first. */
  signals: readonly FunnelSignal[];
  /**
   * How long after the funnel was entered this may count, at the soonest: for
   * a step that means "came back", not "was still there".
   */
  atLeastHoursAfterStart?: number;
}

export interface Funnel {
  id: string;
  title: string;
  /** Whose journey a funnel follows. Accounts only, for now. */
  subject: "account";
  /** How long after entering the funnel a later step still counts. */
  windowDays: number;
  /** In order. The first is how a subject enters the funnel. */
  steps: readonly FunnelStep[];
}

const REGISTRY = Symbol.for("markbase.funnels");
interface RegistryGlobals {
  [REGISTRY]?: Map<string, Funnel>;
}
const globals: RegistryGlobals = globalThis as typeof globalThis & RegistryGlobals;
function registry(): Map<string, Funnel> {
  return (globals[REGISTRY] ??= new Map<string, Funnel>());
}

/**
 * Declare a funnel. Its id is unique, and it has at least two steps. A server
 * can load the module that declares a funnel more than once (one copy per
 * bundle), so the same declaration again is fine; a different funnel under
 * the same id is not.
 */
export function defineFunnel(funnel: Funnel): Funnel {
  if (!/^[a-z][a-z0-9_]*$/.test(funnel.id)) throw new Error(`Funnel id ${funnel.id} must be lower case`);
  if (funnel.steps.length < 2) throw new Error(`Funnel ${funnel.id} needs at least two steps`);
  if (funnel.steps.some((s) => s.signals.length === 0)) throw new Error(`Every step of ${funnel.id} needs a signal`);
  const ids = funnel.steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error(`Funnel ${funnel.id} has two steps with one id`);
  const had = registry().get(funnel.id);
  if (had && JSON.stringify(had) !== JSON.stringify(funnel)) {
    throw new Error(`Funnel ${funnel.id} is declared twice, differently`);
  }
  registry().set(funnel.id, funnel);
  return funnel;
}

export function listFunnels(): Funnel[] {
  return [...registry().values()];
}

export function funnelById(id: string): Funnel | null {
  return registry().get(id) ?? null;
}
