#!/usr/bin/env bash
# Put the installed desktop app back where a fresh install starts: pointed at
# the hosted app (https://markbase.so), signed out. Mounted vaults and their
# folders are left exactly where they are; only the instance and the keys change.
#
#   .claude/skills/markbase-dev-test/scripts/reset-desktop-app.sh --yes
#
# Quits the app first (never while a sign-in is in flight: check the tail of
# ~/Library/Application Support/@markbase/app/vault.log). Relaunch afterwards
# with `open -a Markbase`, or with a debug port for driving it over CDP:
#   open -a Markbase --args --remote-debugging-port=9222
set -euo pipefail

if [ "${1:-}" != "--yes" ]; then
  echo "Signs the installed Markbase app out and points this machine at https://markbase.so." >&2
  echo "Re-run with --yes." >&2
  exit 2
fi

osascript -e 'tell application "Markbase" to quit' 2>/dev/null || true
for _ in $(seq 1 30); do
  pgrep -f 'Applications/Markbase.app/Contents/MacOS/Markbase' >/dev/null || break
  sleep 1
done

# The machine-wide registry the CLI and the app share: the instance (three
# keys) and the CLI's own key, which belongs to the instance being left.
CFG="$HOME/.markbaseConfig/config.json"
INFO="$(curl -sf https://markbase.so/api/v1/instance)"
python3 - "$CFG" "$INFO" <<'PY'
import json, os, sys
path, info = sys.argv[1], json.loads(sys.argv[2])
d = json.load(open(path)) if os.path.exists(path) else {}
d["appUrl"] = info["app_url"]
d["supabaseUrl"] = info["supabase_url"]
d["supabaseKey"] = info["supabase_publishable_key"]
d.pop("apiKey", None)
tmp = path + ".tmp"
json.dump(d, open(tmp, "w"), indent=2)
os.replace(tmp, path)
PY

# The app's own settings: its key, whose it was, any invite code it was
# carrying. signedOut keeps it from borrowing a CLI key on the next launch.
SETTINGS="$HOME/Library/Application Support/@markbase/app/settings.json"
python3 - "$SETTINGS" <<'PY'
import json, os, sys
path = sys.argv[1]
d = json.load(open(path)) if os.path.exists(path) else {}
for k in ("apiKey", "apiKeyEnc", "ownerId", "pendingInviteCode", "inviteCode"):
    d.pop(k, None)
d["signedOut"] = True
os.makedirs(os.path.dirname(path), exist_ok=True)
tmp = path + ".tmp"
json.dump(d, open(tmp, "w"), indent=2)
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY

echo "desktop app: on https://markbase.so, signed out. Launch: open -a Markbase"
