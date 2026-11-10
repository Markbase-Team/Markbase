export const runtime = "nodejs";

// GET /install — a tiny installer script you pipe to bash:
//   curl -fsSL https://skills.markbase.so/install | MARKBASE_API_KEY=... bash
// It writes the personal-skill-library SKILL.md into the agent's skills dir.
// The script itself isn't secret; it uses the caller's MARKBASE_API_KEY to make
// the (authenticated) fetch.
const SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

if [ -z "\${MARKBASE_API_KEY:-}" ]; then
  echo "Set MARKBASE_API_KEY to your API key, e.g.:" >&2
  echo "  curl -fsSL https://skills.markbase.so/install | MARKBASE_API_KEY=jsk_xxx bash" >&2
  exit 1
fi

BASE="https://skills.markbase.so/api/v1"
NAME="personal-skill-library"
DIR="\$HOME/.claude/skills/\$NAME"

mkdir -p "\$DIR"
if curl -fsSL -H "Authorization: Bearer \$MARKBASE_API_KEY" \\
     "\$BASE/skills/\$NAME?format=raw" -o "\$DIR/SKILL.md"; then
  echo "Installed \$NAME at \$DIR/SKILL.md"
  echo "Now tell your agent: \\"use the \$NAME skill to list and install skills\\""
else
  echo "Install failed - check your MARKBASE_API_KEY" >&2
  exit 1
fi
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
