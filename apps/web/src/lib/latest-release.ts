import { RELEASES_REPO } from "@markbase/protocol/downloads";

// The version the Download for Mac buttons offer.
//
// The buttons link to GitHub's `latest/download` permalink, which always serves
// the newest build, so the version is a label and nothing more, and it is left
// off the button when it cannot be had in time — a download that works matters
// more than its label.
//
// It is read from where `releases/latest` redirects to (…/releases/tag/v0.0.7),
// not from the releases API. The API allows 60 anonymous requests an hour per
// IP address, and a host like Vercel shares its outgoing addresses with many
// sites, so in production the API refused and the label never showed — and the
// refusal was cached for the hour like an answer. The redirect is an ordinary
// page request, and only a found tag is cached: a miss is asked again next time.

const TAG = /\/releases\/tag\/v?([^/?#]+)$/;

let cached: { version: string; at: number } | null = null;
const TTL_MS = 60 * 60 * 1000;

/** "0.0.7", or null when it cannot be said. */
export async function latestMacVersion(): Promise<string | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.version;
  try {
    const res = await fetch(`https://github.com/${RELEASES_REPO}/releases/latest`, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const version = TAG.exec(res.headers.get("location") ?? "")?.[1] ?? null;
    if (version) cached = { version, at: Date.now() };
    return version ?? cached?.version ?? null;
  } catch {
    return cached?.version ?? null;
  }
}
