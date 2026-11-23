// Where a sign-up came from — the pure half.
//
// The browser remembers its FIRST visit to the site in a cookie: the page that
// sent it (document.referrer), the URL it landed on, and any utm_* the link
// carried. When that browser later creates an account, the server copies the
// cookie into public.signup_sources (@markbase/server/analytics/funnel/signup-source-store) so the question
// "did this person come from Reddit or from Google?" has an answer per account.
//
// First touch wins: a return visit a week later from a bookmark must not erase
// the Reddit thread that brought them. The one exception is a tagged link —
// utm_source names a campaign on purpose, and that beats an untagged first
// visit. Everything here is a function of its inputs so it can be tested
// without a browser; the component and the route hold the I/O.

export const SIGNUP_SOURCE_COOKIE = "mb_source";

/** Thirty days, in seconds — long enough to cover "saw it, came back to sign up". */
export const SIGNUP_SOURCE_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * How long after an account is created its sign-in may still record a source.
 * An email sign-up confirms its address later, hours later sometimes, and that
 * confirmation is the first sign-in. A log-in by someone who signed up before
 * this existed must not record their current visit as their origin.
 */
export const FRESH_ACCOUNT_MS = 24 * 60 * 60 * 1000;

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export interface SignupSource {
  /** The referring page, as the browser reported it; empty when typed in or unknown. */
  referrer: string;
  /** Path and query of the first page seen, e.g. "/blog/why-markdown?utm_source=reddit". */
  landing_path: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  /** When the browser first saw the site, ISO 8601. */
  first_seen_at: string;
}

const MAX_URL = 512;
const MAX_UTM = 128;

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * The source of the visit happening now, or null when there is nothing worth
 * remembering: a visit the site sent to itself (navigating between our own
 * pages) is not an arrival.
 */
export function captureSource(input: { href: string; referrer: string; now: Date }): SignupSource | null {
  const page = new URL(input.href);
  const utm: Record<UtmKey, string> = {
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_term: "",
    utm_content: "",
  };
  for (const key of UTM_KEYS) utm[key] = clip(page.searchParams.get(key)?.trim() ?? "", MAX_UTM);

  let referrer = input.referrer.trim();
  if (referrer) {
    try {
      if (new URL(referrer).host === page.host) referrer = "";
    } catch {
      referrer = "";
    }
  }

  return {
    referrer: clip(referrer, MAX_URL),
    landing_path: clip(page.pathname + page.search, MAX_URL),
    ...utm,
    first_seen_at: input.now.toISOString(),
  };
}

/**
 * Whether a fresh capture should replace what the cookie already holds. The
 * first visit stands, unless the new one is a tagged link and the old one was
 * not — a campaign link is a deliberate claim about where they came from.
 */
export function shouldReplace(existing: SignupSource | null, incoming: SignupSource): boolean {
  if (!existing) return true;
  return incoming.utm_source !== "" && existing.utm_source === "";
}

export function serializeSource(source: SignupSource): string {
  return encodeURIComponent(JSON.stringify(source));
}

/** The cookie's value back as a source, or null for anything that is not one. */
export function parseSource(value: string | null | undefined): SignupSource | null {
  if (!value) return null;
  let raw: Partial<Record<keyof SignupSource, string>>;
  try {
    raw = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const text = (v: string | undefined, max: number) => (typeof v === "string" ? clip(v, max) : "");
  const first_seen_at = text(raw.first_seen_at, 40);
  if (!first_seen_at || Number.isNaN(Date.parse(first_seen_at))) return null;
  return {
    referrer: text(raw.referrer, MAX_URL),
    landing_path: text(raw.landing_path, MAX_URL),
    utm_source: text(raw.utm_source, MAX_UTM),
    utm_medium: text(raw.utm_medium, MAX_UTM),
    utm_campaign: text(raw.utm_campaign, MAX_UTM),
    utm_term: text(raw.utm_term, MAX_UTM),
    utm_content: text(raw.utm_content, MAX_UTM),
    first_seen_at,
  };
}

/** The `Set-Cookie`-style attribute string the browser writes with the value. */
export function sourceCookieAttributes(secure: boolean): string {
  return `Path=/; Max-Age=${SIGNUP_SOURCE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The one value of `document.cookie` that is ours, or null. */
export function readSourceCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SIGNUP_SOURCE_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Whether an account is new enough that this sign-in is its sign-up. See
 * FRESH_ACCOUNT_MS for why it is a window and not "right now".
 */
export function isFreshAccount(createdAt: string | null | undefined, now: Date): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return now.getTime() - created <= FRESH_ACCOUNT_MS;
}
