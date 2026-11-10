import { isProvider, type Provider } from "./agent-sessions";

// Who the caller is, as the gate tells the feature behind it.
//
// Authentication happens once, in the shell's proxy, before a request reaches
// any feature. What the proxy learned travels on ONE request header as JSON,
// and this module is the only place that header's name and shape are defined:
// the proxy writes it with `serializeCaller`, a handler reads it with
// `callerFromHeaders`, and nothing in between spells the string. A feature
// that reached for `request.headers.get` instead could be handed a forged one —
// the proxy strips the whole `x-markbase-*` namespace from every incoming
// request for exactly that reason.
//
// One header rather than six: `docs` needs the owner, the channel, the
// session's email and three facts about the key, and six loose headers is six
// names to keep in step. One JSON value has one parser.

/** The request header the gate attaches. */
export const CALLER_HEADER = "x-markbase-caller";

/**
 * The namespace the gate owns. Everything under it is dropped from an incoming
 * request before the gate writes its own — not just the header it sets today,
 * so a name added tomorrow is never one a caller could have supplied yesterday.
 */
export const CALLER_HEADER_PREFIX = "x-markbase-";

/**
 * An API key's ceiling on what its holder may do to a document
 * (owner > editor > commenter > viewer). Null is no ceiling.
 */
export type KeyCapability = "owner" | "editor" | "commenter" | "viewer";

const KEY_CAPABILITIES: readonly KeyCapability[] = [
  "owner",
  "editor",
  "commenter",
  "viewer",
];

export function isKeyCapability(
  v: string | null | undefined
): v is KeyCapability {
  return (KEY_CAPABILITIES as readonly string[]).includes(v ?? "");
}

/** The key, as much of it as a feature needs. Never the hash, never the name. */
export interface CallerKey {
  /** The key's row id — the connection an agent session is claimed under. */
  id: string;
  /** Which agent tool holds it; drives the "Jessie's Claude Code" author label. */
  provider: Provider;
  capability: KeyCapability | null;
}

/**
 * Who is calling, and which channel proved it.
 *
 * `ownerId` is whose data this request may reach, on both channels. The rest
 * is what a feature needs to attribute the action: a person is named by their
 * account, an agent by the key's provider and ceiling.
 */
export type Caller =
  | { via: "session"; ownerId: string; email: string | null }
  | { via: "api_key"; ownerId: string; key: CallerKey };

/**
 * The header value for a caller. ASCII only: a header field cannot carry a
 * raw non-Latin-1 character, and an email can, so anything outside printable
 * ASCII goes as a JSON `\uXXXX` escape — which is still JSON, and still
 * exactly the value `parseCaller` reads back.
 */
export function serializeCaller(caller: Caller): string {
  return JSON.stringify(caller).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

/** The shape on the wire, before anything about it has been checked. */
interface CallerWire {
  via?: string | null;
  ownerId?: string | null;
  email?: string | null;
  key?: {
    id?: string | null;
    provider?: string | null;
    capability?: string | null;
  } | null;
}

/**
 * Read a header value back into a caller.
 *
 * Throws on a value that is present but not a caller. The gate is the only
 * writer, so a malformed value is a bug in the gate — and a bug there must not
 * read as "nobody is signed in", which is what returning null would mean.
 */
export function parseCaller(value: string): Caller {
  let wire: CallerWire | null;
  try {
    wire = JSON.parse(value) as CallerWire | null;
  } catch {
    throw new Error(`${CALLER_HEADER}: not JSON`);
  }
  if (!wire || typeof wire !== "object") {
    throw new Error(`${CALLER_HEADER}: not an object`);
  }
  if (typeof wire.ownerId !== "string" || !wire.ownerId) {
    throw new Error(`${CALLER_HEADER}: missing ownerId`);
  }
  if (wire.via === "session") {
    return {
      via: "session",
      ownerId: wire.ownerId,
      email: typeof wire.email === "string" ? wire.email : null,
    };
  }
  if (wire.via === "api_key") {
    const key = wire.key;
    if (!key || typeof key.id !== "string" || !key.id) {
      throw new Error(`${CALLER_HEADER}: api_key without a key id`);
    }
    return {
      via: "api_key",
      ownerId: wire.ownerId,
      key: {
        id: key.id,
        provider: isProvider(key.provider) ? key.provider : "unknown",
        capability: isKeyCapability(key.capability) ? key.capability : null,
      },
    };
  }
  throw new Error(`${CALLER_HEADER}: unknown via '${String(wire.via)}'`);
}

/**
 * Who the gate says is calling, or null when it attached nobody.
 *
 * Null is an ANONYMOUS request, which only reaches a feature behind a prefix
 * the gate guards in `optional` mode — one that has its own way of admitting a
 * stranger, such as a share token. Behind a `required` prefix the gate has
 * already refused that request, and a handler there may take the caller for
 * granted.
 */
export function callerFromHeaders(headers: Headers): Caller | null {
  const value = headers.get(CALLER_HEADER);
  return value === null ? null : parseCaller(value);
}
