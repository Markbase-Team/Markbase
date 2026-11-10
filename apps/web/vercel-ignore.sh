#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the @markbase/web app.
#
# Exit code 1 => proceed with the build & deploy.
# Exit code 0 => skip the build (no deploy).
#
# We only deploy when the push touches the web app or one of the workspace
# packages it actually compiles in (see next.config.ts `transpilePackages`).
# Pushes that only touch unrelated parts of the monorepo (apps/markbase,
# supabase/, docs, .claude/, etc.) skip the build.

set -uo pipefail

# Can't diff against a parent (first deploy / shallow clone) — build to be safe.
if ! git rev-parse "HEAD^" >/dev/null 2>&1; then
  echo "No parent commit — building."
  exit 1
fi

# apps/web + every workspace package it compiles in + the root manifests.
# Packages live under packages/core/* and packages/features/* now; the old
# flat packages/<name>/ list silently matched nothing after the move, so every
# push that changed only a package — the docs feature included — was
# "no web-relevant changes" and production stayed on the last apps/web edit.
RELEVANT='^(apps/web/|packages/(core|features)/|package(-lock)?\.json$)'

if git diff --name-only "HEAD^" "HEAD" | grep -qE "$RELEVANT"; then
  echo "Web app or a transpiled dependency changed — building."
  exit 1
fi

echo "No web-relevant changes — skipping build."
exit 0
