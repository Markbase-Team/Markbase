// Where the desktop app is published.
//
// One constant, because two places offer it — the marketing landing and the New
// Vault modal, where "local folder" is a dead end without it. Published by
// apps/app/scripts/publish-dmg.sh.
//
// `releases/latest/download/…` is resolved by GitHub to the newest release, so
// this never needs updating and nothing linking to it goes stale.
/**
 * The repository the desktop builds are released on — this one, now that it is
 * public. Builds up to 0.0.7 were also published on Jarxi/markbase-releases,
 * and stay there for links that point at it.
 */
export const RELEASES_REPO = "Markbase-Team/Markbase";

/** The source repository, linked from the site and named in its structured data. */
export const REPO_URL = `https://github.com/${RELEASES_REPO}`;

export const MAC_DOWNLOAD_URL =
  `https://github.com/${RELEASES_REPO}/releases/latest/download/Markbase-arm64.dmg`;

/**
 * What to do the first time the app is opened, shown wherever it is offered.
 * The build is signed with a Developer ID but not yet notarised, and macOS
 * (Sequoia and later) blocks an app that is not notarised until it is allowed
 * once in System Settings; right-click → Open no longer gets past it. Set to
 * null once a notarised build is the latest release.
 */
export const MAC_FIRST_OPEN_NOTE: string | null =
  "Not notarised yet: the first time, open the app, then allow it under System Settings → Privacy & Security → Open Anyway.";
