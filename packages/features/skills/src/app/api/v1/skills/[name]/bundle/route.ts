import { getSkillByName } from "@markbase/protocol/skills";
import { listSkillFiles } from "@markbase/protocol/skill-files";
import { buildSkillTarball } from "@markbase/node/skill-bundle";
import { callerFromHeaders } from "@markbase/protocol/auth";

// GET /api/v1/skills/:name/bundle — the whole skill as a .tar.gz (SKILL.md +
// scripts/ + references/ + assets/), assembled on the fly. Pipe straight to
// tar to install a complete skill in one command:
//   curl -H 'Authorization: Bearer <key>' .../skills/<name>/bundle \
//     | tar -xz -C ~/.claude/skills/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  const { name } = await params;
  const skill = await getSkillByName(name, caller.ownerId);
  if (!skill) return Response.json({ error: "Skill not found" }, { status: 404 });

  const files = await listSkillFiles(skill.id);
  const tgz = buildSkillTarball(skill, files);

  return new Response(new Uint8Array(tgz), {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${skill.name}.tar.gz"`,
      "Content-Length": String(tgz.length),
      "Cache-Control": "no-store",
    },
  });
}
