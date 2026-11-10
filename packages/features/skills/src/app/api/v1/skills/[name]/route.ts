import { buildSkillMd, getSkillByName } from "@markbase/protocol/skills";
import { listSkillFiles } from "@markbase/protocol/skill-files";
import { callerFromHeaders } from "@markbase/protocol/auth";

// GET /api/v1/skills/:name — the skill as JSON, or the raw SKILL.md when
// `?format=raw` (or Accept: text/markdown) so an agent can write it straight to
// <skills-dir>/<name>/SKILL.md.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  const { name } = await params;
  const skill = await getSkillByName(name, caller.ownerId);
  if (!skill) return Response.json({ error: "Skill not found" }, { status: 404 });

  const skillMd = buildSkillMd(skill);

  const url = new URL(req.url);
  const wantsRaw =
    url.searchParams.get("format") === "raw" ||
    (req.headers.get("accept") ?? "").includes("text/markdown");
  if (wantsRaw) {
    return new Response(skillMd, {
      status: 200,
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  const base = url.origin;
  const files = await listSkillFiles(skill.id);
  const inlineContent = url.searchParams.get("include") === "files";

  return Response.json({
    name: skill.name,
    description: skill.description,
    version: skill.version,
    body: skill.body,
    skill_md: skillMd,
    // The bundled extras (scripts/, references/, assets/). Content is omitted
    // by default — fetch the whole skill as one archive via bundle_url, or
    // install in one command. With ?include=files, file contents are inlined.
    files: files.map((f) =>
      inlineContent
        ? { path: f.path, executable: f.executable, content: f.content }
        : { path: f.path, executable: f.executable }
    ),
    bundle_url: `${base}/api/v1/skills/${skill.name}/bundle`,
    install_url: `${base}/api/v1/skills/${skill.name}/install`,
    install: {
      // One command installs the complete skill (SKILL.md + all files).
      command: `curl -fsSL ${base}/api/v1/skills/${skill.name}/install | MARKBASE_API_KEY=$MARKBASE_API_KEY bash`,
      dir: `~/.claude/skills/${skill.name}/`,
      instructions:
        `Run 'command' to install the whole skill into ~/.claude/skills/${skill.name}/, ` +
        `then it is /-callable. (For a single-file skill you can instead write ` +
        `'skill_md' to ~/.claude/skills/${skill.name}/SKILL.md.)`,
    },
  });
}
