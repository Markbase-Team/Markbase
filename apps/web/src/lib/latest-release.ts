import { RELEASES_REPO } from "@markbase/protocol/downloads";

// The version the Download for Mac buttons offer.
//
// The buttons link to GitHub's `latest/download` permalink, which always serves
// the newest build, so the version is a label and nothing more: asked of
// GitHub's API, cached for an hour, and left off the button when GitHub does
// not answer in time — a download that works matters more than its label.

/** What the releases API answers, as much of it as this reads. */
interface LatestRelease {
  tag_name?: string;
}

/** "0.0.7", or null when it cannot be said. */
export async function latestMacVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as LatestRelease;
    const tag = body.tag_name?.trim();
    return tag ? tag.replace(/^v/, "") : null;
  } catch {
    return null;
  }
}
