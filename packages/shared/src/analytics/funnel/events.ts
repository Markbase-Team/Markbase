// Funnel events: the moments in the product only we care about — a modal
// shown, an account signed up, an app signed in — written to
// public.funnel_events and read by funnels (./funnels.ts).
//
// An event is an action and a source, kept apart: `account.sign_in` from
// "desktop" and from "cli" is one action that happened in two places, so a
// funnel can count it once or split it by where.
//
// What people and agents do to their own data is not one of these: that is
// user analytics (../user-analytics.ts), which the customer can see, and a
// funnel reads it from there. Each fact is recorded in exactly one of the two.
//
// Names are a closed set, declared by whoever reports them (a feature, or the
// app itself) with `defineFunnelEvents`, the way endpoints are declared. The
// server refuses a name nobody declared, so a page cannot fill the table with
// whatever it likes, and a name means one thing: two owners cannot declare the
// same one. Props are a few short strings, never free text a person typed.

import { api } from "../../api-client";

/** Short string values only: an agent id, a way of closing. */
export type FunnelEventProps = Record<string, string>;

/**
 * Where an event happened: the web app, the desktop app, the CLI, or an AI
 * app reaching Markbase over MCP (a connector).
 */
export const FUNNEL_SOURCES = ["web", "desktop", "cli", "mcp"] as const;
export type FunnelSource = (typeof FUNNEL_SOURCES)[number];

export function isFunnelSource(value: string | null | undefined): value is FunnelSource {
  return (FUNNEL_SOURCES as readonly string[]).includes(value ?? "");
}

export interface FunnelEvent<N extends string = string> {
  name: N;
  source: FunnelSource;
  props: FunnelEventProps;
}

export const FUNNEL_EVENTS_PATH = "/api/v1/funnel-events";

const MAX_PROPS = 8;
const MAX_KEY = 40;
const MAX_VALUE = 128;
/** `thing.action`: "account.sign_in", "connect_modal.show". */
const NAME = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

// On globalThis for the same reason as the endpoint observers: the code that
// declares and the code that checks can be bundled apart.
const REGISTRY = Symbol.for("markbase.funnel-events");
interface RegistryGlobals {
  [REGISTRY]?: Map<string, string>;
}
const globals: RegistryGlobals = globalThis as typeof globalThis & RegistryGlobals;
function registry(): Map<string, string> {
  return (globals[REGISTRY] ??= new Map<string, string>());
}

/** What a declaration hands back: its names, and a way to report one of them. */
export interface FunnelEvents<N extends string> {
  owner: string;
  names: readonly N[];
  /**
   * Report an event from a page. Fire-and-forget: a failed report must never
   * get in the way of what the person is doing, so nothing here throws or is
   * awaited.
   */
  track(name: N, source: FunnelSource, props?: FunnelEventProps): void;
}

/**
 * Declare the funnel events `owner` reports. Names are `thing.action` in lower
 * case ("account.sign_in") — the action only; where it happened is the
 * event's source. Declaring one twice, from anywhere, throws.
 */
export function defineFunnelEvents<const N extends string>(owner: string, names: readonly N[]): FunnelEvents<N> {
  for (const name of names) {
    if (!NAME.test(name)) throw new Error(`Funnel event ${name} must be thing.action, lower case`);
    const had = registry().get(name);
    if (had !== undefined && had !== owner) throw new Error(`Funnel event ${name} is declared by both ${had} and ${owner}`);
    registry().set(name, owner);
  }
  return {
    owner,
    names,
    track(name, source, props = {}) {
      void api
        .request(FUNNEL_EVENTS_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, source, props }),
        })
        .catch(() => undefined);
    },
  };
}

/** Whether someone declared this name. */
export function isFunnelEventName(value: string | null | undefined): boolean {
  return typeof value === "string" && registry().has(value);
}

/** Every declared name, with who declared it. */
export function declaredFunnelEvents(): { name: string; owner: string }[] {
  return [...registry()].map(([name, owner]) => ({ name, owner }));
}

/** What a request body may look like before it is checked. */
export interface FunnelEventBody {
  name?: string;
  source?: string;
  props?: Record<string, string | number | boolean | null | object>;
}

/** Props cut down to what may be stored: at most 8 short strings. */
export function cleanFunnelProps(raw: FunnelEventBody["props"] | null | undefined): FunnelEventProps {
  const props: FunnelEventProps = {};
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const [key, value] of Object.entries(source)) {
    if (Object.keys(props).length >= MAX_PROPS) break;
    if (typeof value !== "string" || key.length === 0 || key.length > MAX_KEY) continue;
    props[key] = value.slice(0, MAX_VALUE);
  }
  return props;
}

/**
 * The event a request body describes, or null when it is not a declared one
 * from a known source.
 * Props that are not short strings are dropped rather than refusing the
 * event: a page that sends a number by mistake should still be counted.
 */
export function parseFunnelEvent(body: FunnelEventBody | null | undefined): FunnelEvent | null {
  if (!body || typeof body !== "object") return null;
  if (typeof body.name !== "string" || !isFunnelEventName(body.name)) return null;
  if (!isFunnelSource(body.source)) return null;
  return { name: body.name, source: body.source, props: cleanFunnelProps(body.props) };
}
