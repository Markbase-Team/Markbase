import {
  deleteSkill,
  getSkillById,
  updateSkill,
  SKILL_NAME_RE,
} from "@markbase/protocol/skills";
import { callerFromHeaders } from "@markbase/protocol/auth";

// GET /api/admin/skills/:id — one skill (for the editor workspace).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;
  const skill = await getSkillById(id, caller.ownerId);
  if (!skill) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ skill });
}

// PATCH /api/admin/skills/:id — edit a skill's name, description, or body.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;

  let body: { name?: string; description?: string; body?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: { name?: string; description?: string; body?: string } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().toLowerCase();
    if (!SKILL_NAME_RE.test(name)) {
      return Response.json(
        { error: "name must be kebab-case (lowercase letters, numbers, hyphens)" },
        { status: 400 }
      );
    }
    patch.name = name;
  }
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.body === "string") patch.body = body.body;

  const skill = await updateSkill(id, patch, caller.ownerId);
  return Response.json({ skill });
}

// DELETE /api/admin/skills/:id — remove a skill.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;
  await deleteSkill(id, caller.ownerId);
  return Response.json({ ok: true });
}
