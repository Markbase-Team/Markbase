import {
  isSafeSkillPath,
  listSkillFiles,
  upsertSkillFile,
} from "@markbase/protocol/skill-files";
import { callerFromHeaders } from "@markbase/protocol/auth";

// GET /api/admin/skills/:id/files — the skill's bundled files (with content).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;
  return Response.json({ files: await listSkillFiles(id) });
}

// POST /api/admin/skills/:id/files  { path, content?, executable? } — add a file.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;

  let body: { path?: string; content?: string; executable?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!isSafeSkillPath(path)) {
    return Response.json(
      {
        error:
          'path must be a relative file path like scripts/run.sh (no "..", no leading "/", not SKILL.md)',
      },
      { status: 400 }
    );
  }

  const file = await upsertSkillFile(id, {
    path,
    content: typeof body.content === "string" ? body.content : "",
    executable: body.executable === true,
  });
  return Response.json({ file }, { status: 201 });
}
