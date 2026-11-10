#!/usr/bin/env bash
#
# Publish the packaged macOS app so the landing page can link to it.
#
# The DMG is ~190 MB, which is why it does not live in git. It goes to GitHub
# Releases on a SEPARATE PUBLIC repo — Jarxi/markbase-releases — that holds no
# source. The main repo is private, and release assets on a private repo need a
# token to fetch, so a public download button there would 404 for every visitor.
#
# The landing page links to:
#   https://github.com/Jarxi/markbase-releases/releases/latest/download/Markbase-arm64.dmg
#
# `latest/download/<name>` is resolved by GitHub to the newest release, so the
# link never needs updating and nothing that already points at it goes stale.
# That is why the asset name carries no version while the TAG does.
#
#   ./scripts/publish-dmg.sh v0.0.2               # build, then publish
#   ./scripts/publish-dmg.sh v0.0.2 --skip-build
#
# Supabase storage was the first attempt and is not viable: a project-wide upload
# limit caps every bucket, is not exposed in the database or the storage API, and
# sits below the size of a packaged Electron app.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASES_REPO="Jarxi/markbase-releases"
ASSET="Markbase-arm64.dmg"

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "usage: $0 <tag> [--skip-build]     e.g. $0 v0.0.2" >&2
  exit 1
fi
skip_build=false
[[ "${2:-}" == "--skip-build" ]] && skip_build=true

# gh must be the account that owns the releases repo. This machine has two, and
# the wrong one 404s on a repo it cannot see — which looks like "no such repo"
# rather than "wrong identity".
who="$(gh api user --jq .login 2>/dev/null || true)"
if ! gh repo view "$RELEASES_REPO" --json name >/dev/null 2>&1; then
  echo "error: gh (as '${who:-not signed in}') cannot see $RELEASES_REPO." >&2
  echo "       try: gh auth switch --user Jarxi" >&2
  exit 1
fi

# electron-builder names the file after apps/app/package.json's version.
VERSION="$(node -p "require('$APP_DIR/package.json').version")"
DMG="$APP_DIR/release/Markbase-${VERSION}-arm64.dmg"
if [[ "$skip_build" == false ]]; then
  echo "==> packaging"
  ( cd "$APP_DIR" && npm run dist )
fi
[[ -f "$DMG" ]] || { echo "error: no DMG at $DMG — run without --skip-build" >&2; exit 1; }

# Upload under the stable name, whatever electron-builder called it locally.
STAGED="$(mktemp -d)/$ASSET"
cp "$DMG" "$STAGED"
echo "==> publishing $(du -h "$STAGED" | cut -f1) as $TAG"

NOTES="macOS, Apple silicon.

Not notarised — right-click the app and choose **Open** the first time; a double-click will be refused."

# Retried: a ~190 MB upload over a lossy link drops often enough that a single
# attempt is not a fair test, and gh reports the drop as a bare \`EOF\`.
published=false
for attempt in 1 2 3; do
  if gh release view "$TAG" --repo "$RELEASES_REPO" >/dev/null 2>&1; then
    gh release upload "$TAG" "$STAGED" --repo "$RELEASES_REPO" --clobber && published=true && break
  else
    gh release create "$TAG" "$STAGED" --repo "$RELEASES_REPO" \
      --title "Markbase ${TAG#v} (macOS, Apple silicon)" --notes "$NOTES" && published=true && break
  fi
  echo "   attempt $attempt failed; retrying…" >&2
  sleep 10
done
$published || { echo "error: could not publish after 3 attempts" >&2; exit 1; }

# The upload can report success while the asset is still processing, and a
# half-published release is exactly what a download button must never point at.
state="$(gh release view "$TAG" --repo "$RELEASES_REPO" --json assets \
  --jq ".assets[] | select(.name==\"$ASSET\") | .state" 2>/dev/null || true)"
[[ "$state" == "uploaded" ]] || { echo "error: asset state is '${state:-missing}', not 'uploaded'" >&2; exit 1; }

echo
echo "published: https://github.com/$RELEASES_REPO/releases/download/$TAG/$ASSET"
echo "permalink: https://github.com/$RELEASES_REPO/releases/latest/download/$ASSET"
