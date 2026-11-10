import { listSkills, upsertSkill, SKILL_NAME_RE } from "@markbase/protocol/skills";
import { callerFromHeaders } from "@markbase/protocol/auth";

// Authentication happens in the shell's proxy — /api/admin/skills is a
// `required` prefix there, so a request that reaches this file carries a
// caller. The check below is what makes that assumption visible.

// GET /api/admin/skills — all stored skills.
export async function GET(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  return Response.json({ skills: await listSkills(caller.ownerId) });
}

// POST /api/admin/skills  { name, description?, body? } — create a skill.
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  let body: { name?: string; description?: string; body?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name =
    typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
  if (!SKILL_NAME_RE.test(name)) {
    return Response.json(
      { error: "name must be kebab-case (lowercase letters, numbers, hyphens)" },
      { status: 400 }
    );
  }
  const skill = await upsertSkill(
    {
      name,
      description:
        typeof body.description === "string" ? body.description.trim() : "",
      body: typeof body.body === "string" ? body.body : "",
    },
    caller.ownerId
  );
  return Response.json({ skill }, { status: 201 });
}
