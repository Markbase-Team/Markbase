#!/usr/bin/env bash
# Put the LOCAL Markbase test stack back to "fresh instance": no accounts, no
# invites, no documents. Every instance container on this machine that runs
# against the local Supabase stack is restarted so it prints a fresh invite link.
#
#   .claude/skills/markbase-dev-test/scripts/reset-local-stack.sh --yes
#
# The local database is shared by every worktree's dev server and instance:
# tell sibling sessions before running this.
set -euo pipefail

if [ "${1:-}" != "--yes" ]; then
  echo "This wipes every account, invite and document on the LOCAL Supabase stack" >&2
  echo "(shared by every worktree's dev server and instance). Re-run with --yes." >&2
  exit 2
fi

REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$REPO"

echo "1/4  resetting the local database from supabase/migrations (no seed)…"
npx -y supabase@2 db reset --local --yes

echo "2/4  restoring the API role's grants (the local image's defaults leave service_role without them)…"
DB="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -1)"
docker exec "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -c "grant all on all tables in schema public to service_role;" \
  -c "grant all on all sequences in schema public to service_role;" \
  -c "create schema if not exists tax;" \
  -c "select pg_notify('pgrst', 'reload schema');"

# PostgREST reloads its schema cache after the reset; an instance restarted
# before that answers "Could not query the database for the schema cache" and
# never prints its link. The publishable key is in the worktree's .env.
echo "3/4  waiting for the stack's REST API, then restarting the instance container(s)…"
KEY="$(grep -h '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
if [ -n "$KEY" ]; then
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $KEY" http://127.0.0.1:54321/rest/v1/)" = 200 ] && break
    sleep 2
  done
else
  sleep 10
fi
WEBS="$(docker ps --format '{{.Names}}' | grep -E -- '-web-1$' || true)"
for c in $WEBS; do docker restart "$c" >/dev/null; done
sleep 12

echo "4/4  fresh invite links (the first account on each instance comes from its link):"
for c in $WEBS; do
  port="$(docker port "$c" 3000/tcp 2>/dev/null | head -1 | sed 's/.*://')"
  link="$(docker logs "$c" 2>&1 | grep 'Invite link' | tail -1 | sed 's/.*Invite link: //')"
  printf '  %-40s port %-5s %s\n' "$c" "${port:-?}" "${link:-(not printed yet: docker logs $c | grep 'Invite link')}"
done
