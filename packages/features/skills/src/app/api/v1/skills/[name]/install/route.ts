import { SKILL_NAME_RE } from "@markbase/protocol/skills";

// GET /api/v1/skills/:name/install — a bash installer you pipe to a shell. It
// downloads the skill's bundle and unpacks it into ~/.claude/skills/<name>/, so
// installing a complete skill is one command (npm-install style):
//   curl -fsSL .../skills/<name>/install | MARKBASE_API_KEY=jsk_xxx bash
// The script isn't secret; it uses the caller's MARKBASE_API_KEY for the
// (authenticated) bundle fetch. This is why /api/v1/skills is guarded as
// `optional` in the proxy: this handler must answer with no credentials.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!SKILL_NAME_RE.test(name)) {
    return new Response("Invalid skill name\n", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const base = new URL(req.url).origin;
  const script = `#!/usr/bin/env bash
set -euo pipefail

if [ -z "\${MARKBASE_API_KEY:-}" ]; then
  echo "Set MARKBASE_API_KEY to your API key, e.g.:" >&2
  echo "  curl -fsSL ${base}/api/v1/skills/${name}/install | MARKBASE_API_KEY=jsk_xxx bash" >&2
  exit 1
fi

NAME="${name}"
DEST="\$HOME/.claude/skills"
mkdir -p "\$DEST"

echo "Installing \$NAME…"
if curl -fsSL -H "Authorization: Bearer \$MARKBASE_API_KEY" \\
     "${base}/api/v1/skills/\$NAME/bundle" | tar -xz -C "\$DEST"; then
  echo "Installed \$NAME at \$DEST/\$NAME"
  echo "Tell your agent: \\"use the \$NAME skill\\""
else
  echo "Install failed - check your MARKBASE_API_KEY and that the skill exists" >&2
  exit 1
fi
`;

  return new Response(script, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
