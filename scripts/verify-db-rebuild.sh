#!/usr/bin/env bash
#
# Prove the repo can still build its own database, and that the result is
# locked down. Run before opening a PR that touches supabase/, and in CI.
#
#   scripts/verify-db-rebuild.sh
#
# It needs Docker and the Supabase CLI. It RESETS the local Supabase database
# (not the linked project) -- local data is disposable by design.
#
# Why this exists: for months the repo could not rebuild its own database. The
# migrations that create the base schema were applied straight to production and
# never committed, and shared date prefixes (20260709_*) collided on version, so
# `supabase db reset` failed outright. Nothing caught it because nothing ever
# rebuilt from scratch. This is that check.
set -euo pipefail

cd "$(dirname "$0")/.."
DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

echo "==> checking for duplicate migration versions"
dupes=$(ls supabase/migrations/*.sql | xargs -n1 basename | sed -E 's/^([0-9]+)_.*/\1/' | sort | uniq -d)
if [ -n "$dupes" ]; then
  echo "FAIL: migrations share a version, so only the first one applies:"
  echo "$dupes"
  exit 1
fi

echo "==> rebuilding the local database from supabase/migrations"
supabase db reset

echo "==> installing pgTAP"
psql "$DB" -X -q -c "create extension if not exists pgtap;"

echo "==> running database tests"
failed=0
for t in supabase/tests/*.test.sql; do
  out=$(psql "$DB" -X -q -At -f "$t" 2>&1)
  pass=$(printf '%s\n' "$out" | grep -cE '^ok ' || true)
  fail=$(printf '%s\n' "$out" | grep -cE '^not ok ' || true)
  printf '%s: %s passed, %s failed\n' "$(basename "$t")" "$pass" "$fail"
  if [ "$fail" -ne 0 ]; then
    printf '%s\n' "$out" | grep -E '^not ok ' || true
    failed=1
  fi
  # A SQL error aborts the transaction, and every assertion after it emits
  # nothing at all -- the run then looks like "0 failed" while silently
  # skipping the rest. Treat any error as a failure, or the suite can stop
  # testing without anyone noticing.
  if printf '%s\n' "$out" | grep -qE 'ERROR:|FATAL:'; then
    echo "  SQL error -- assertions after this point did not run:"
    printf '%s\n' "$out" | grep -E 'ERROR:|FATAL:' | head -5
    failed=1
  fi
done

[ "$failed" -eq 0 ] || { echo "FAIL: database tests failed"; exit 1; }
echo "==> ok: the database rebuilds from scratch and passes its tests"
