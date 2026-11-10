import { fetchWithTimeout } from "./timeout-fetch";

// Pointing a client at a Markbase instance.
//
// A team that hosts its own Markbase (SELF-HOSTING.md) has one URL, and that URL
// is all a team member should need — the way a Grafana is joined. But the
// clients do not only talk to the API at that URL: the ticket worker and the
// desktop window reach the instance's Supabase project directly, with the
// project's public URL and publishable key. The instance says which project it
// runs on (GET /api/v1/instance, public), and connecting saves the answer where
// every command and the desktop app read it.
//
// This is the half every client shares: what the URL a person typed means, and
// whether what the instance answered is usable. Saving the answer needs a
// filesystem and lives with the registry (@markbase/vault); the CLI command and
// the desktop control each call these and then save.

/** The hosted app — what a machine talks to until it is pointed elsewhere. */
export const DEFAULT_APP_URL = "https://markbase.so";

/** What GET /api/v1/instance answers. Mirrors the server's InstanceInfo. */
export interface InstanceInfo {
  app_url: string;
  supabase_url: string;
  supabase_publishable_key: string;
}

/** The shape on the wire before it has been checked. */
interface InstanceWire {
  app_url?: string;
  supabase_url?: string;
  supabase_publishable_key?: string;
  error?: string;
}

/**
 * The URL as it is saved: a scheme (https unless one was given, except that a
 * bare localhost is a dev server and gets http), no path, no trailing slash.
 * Throws on anything that is not a URL at all.
 */
export function normalizeInstanceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("No instance URL given.");
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `${local ? "http" : "https"}://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`"${raw}" is not a URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`An instance URL is http(s), not ${url.protocol.replace(/:$/, "")}.`);
  }
  // The origin is the instance; a pasted dashboard link is still that instance.
  return url.origin;
}

/** As much of a Response as this needs — so a test can hand in a plain object. */
export interface InstanceResponse {
  ok: boolean;
  status: number;
  json(): Promise<InstanceWire>;
}
export type InstanceFetch = (url: string) => Promise<InstanceResponse>;

/** The real fetch, with its body read as the wire shape above. */
const fetchInstanceResponse: InstanceFetch = async (url) => {
  const res = await fetchWithTimeout(url);
  return {
    ok: res.ok,
    status: res.status,
    json: () => res.json() as Promise<InstanceWire>,
  };
};

/**
 * Why the fetch failed, in words that tell a typo from a server that is down.
 *
 * Node's fetch says only "fetch failed" and keeps the reason in `cause` — a
 * plain Error for a DNS miss or a bad certificate, and for a refused port an
 * AggregateError with an empty message, one error per address the host
 * resolved to ("connect ECONNREFUSED ::1:3999", then 127.0.0.1). The first of
 * those is the line a person needs.
 */
function reachFailure(e: Error): string {
  const cause = e.cause instanceof Error ? e.cause : null;
  if (!cause) return e.message;
  const first =
    cause instanceof AggregateError && cause.errors[0] instanceof Error ? cause.errors[0] : cause;
  return first.message || cause.message || e.message;
}

/** Ask an instance which Supabase project it runs on. */
export async function fetchInstance(
  base: string,
  fetchImpl: InstanceFetch = fetchInstanceResponse
): Promise<InstanceInfo> {
  let res: InstanceResponse;
  try {
    res = await fetchImpl(`${base}/api/v1/instance`);
  } catch (e) {
    throw new Error(`Could not reach ${base} (${e instanceof Error ? reachFailure(e) : String(e)}).`);
  }
  let body: InstanceWire = {};
  try {
    body = await res.json();
  } catch {
    // Not JSON: an older server, or not a Markbase at all. Said below.
  }
  if (!res.ok) {
    const why = body.error ? `: ${body.error}` : "";
    throw new Error(
      res.status === 404
        ? `${base} does not answer /api/v1/instance — is it a Markbase, and up to date?`
        : `${base} refused (HTTP ${res.status})${why}.`
    );
  }
  if (
    typeof body.supabase_url !== "string" ||
    typeof body.supabase_publishable_key !== "string" ||
    !body.supabase_url ||
    !body.supabase_publishable_key
  ) {
    throw new Error(`${base} answered /api/v1/instance without a Supabase project.`);
  }
  return {
    app_url: typeof body.app_url === "string" && body.app_url ? body.app_url : base,
    supabase_url: body.supabase_url,
    supabase_publishable_key: body.supabase_publishable_key,
  };
}

// ---- The join link -----------------------------------------------------------
//
// An instance hands the desktop app its own address through a link a page can
// offer: `markbase://connect?instance=https://markbase.example.com&code=…`. The
// app registers the scheme with the OS, parses the link with `parseConnectLink`,
// connects, and — when the link carried the instance's invite code — offers to
// create the account on its first sign-in there. The admin shares the
// instance's /join page; nobody types a URL into the app.

/** The scheme the desktop app registers with the OS. */
export const CONNECT_SCHEME = "markbase";

/** The host inside the scheme that means "join this instance". */
const CONNECT_HOST = "connect";

/** What a connect link names. */
export interface ConnectTarget {
  /** The instance, normalized. */
  appUrl: string;
  /** The invite code the link carried, for creating an account there; null when it carried none. */
  inviteCode: string | null;
}

/** The link a page offers to hand the desktop app `appUrl`, and the invite code if the page has one. */
export function connectLink(appUrl: string, inviteCode?: string): string {
  const url = normalizeInstanceUrl(appUrl);
  const base = `${CONNECT_SCHEME}://${CONNECT_HOST}?instance=${encodeURIComponent(url)}`;
  return inviteCode ? `${base}&code=${encodeURIComponent(inviteCode)}` : base;
}

/**
 * The instance a connect link names, normalized, or null when `raw` is not a
 * connect link: another scheme, another host under this one (the app serves
 * its own pages at markbase://app and must never treat those as a request to
 * switch), or an `instance` that is not a URL.
 */
export function parseConnectLink(raw: string): ConnectTarget | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${CONNECT_SCHEME}:` || url.host !== CONNECT_HOST) return null;
  const instance = url.searchParams.get("instance");
  if (!instance) return null;
  try {
    const code = url.searchParams.get("code")?.trim();
    return { appUrl: normalizeInstanceUrl(instance), inviteCode: code ? code : null };
  } catch {
    return null;
  }
}

/**
 * The instance's join page — the one link an admin shares with a teammate.
 * The page (apps/web/src/app/join) gets them an account there and offers the
 * connect link above; Settings on both shells shows this, ready to copy.
 */
export function joinLink(appUrl: string, inviteCode?: string): string {
  const url = `${normalizeInstanceUrl(appUrl)}/join`;
  return inviteCode ? `${url}?code=${encodeURIComponent(inviteCode)}` : url;
}
