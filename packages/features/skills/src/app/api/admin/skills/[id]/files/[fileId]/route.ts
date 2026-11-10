import {
  deleteSkillFile,
  isSafeSkillPath,
  updateSkillFile,
} from "@markbase/protocol/skill-files";
import { callerFromHeaders } from "@markbase/protocol/auth";

// PATCH /api/admin/skills/:id/files/:fileId — edit a file's path/content/mode.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { fileId } = await params;

  let body: { path?: string; content?: string; executable?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: { path?: string; content?: string; executable?: boolean } = {};
  if (typeof body.path === "string") {
    const path = body.path.trim();
    if (!isSafeSkillPath(path)) {
      return Response.json(
        { error: 'path must be a relative file path (no "..", no leading "/", not SKILL.md)' },
        { status: 400 }
      );
    }
    patch.path = path;
  }
  if (typeof body.content === "string") patch.content = body.content;
  if (typeof body.executable === "boolean") patch.executable = body.executable;

  const file = await updateSkillFile(fileId, patch);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ file });
}

// DELETE /api/admin/skills/:id/files/:fileId — remove a file.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { fileId } = await params;
  await deleteSkillFile(fileId);
  return Response.json({ ok: true });
}
