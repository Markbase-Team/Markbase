// Where the desktop app is published.
//
// One constant, because two places offer it — the marketing landing and the New
// Vault modal, where "local folder" is a dead end without it. Published by
// apps/app/scripts/publish-dmg.sh.
//
// `releases/latest/download/…` is resolved by GitHub to the newest release, so
// this never needs updating and nothing linking to it goes stale.
/** The public repository the desktop builds are released on. */
export const RELEASES_REPO = "Jarxi/markbase-releases";

export const MAC_DOWNLOAD_URL =
  `https://github.com/${RELEASES_REPO}/releases/latest/download/Markbase-arm64.dmg`;
