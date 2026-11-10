import {
  buildSkillMd,
  listSkills,
  parseSkillMd,
  upsertSkill,
  SKILL_NAME_RE,
} from "@markbase/protocol/skills";
import {
  isSafeSkillPath,
  replaceSkillFiles,
  type SkillFileInput,
} from "@markbase/protocol/skill-files";
import { callerFromHeaders } from "@markbase/protocol/auth";

// Authentication and CORS happen in the shell's proxy. /api/v1/skills is an
// `optional` prefix there — the install script below it is public — so every
// handler here other than install checks for a caller itself.

// GET /api/v1/skills — list available skills (name + description).
export async function GET(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  const base = new URL(req.url).origin;
  const skills = (await listSkills(caller.ownerId)).map((s) => ({
    name: s.name,
    description: s.description,
    version: s.version,
    updated_at: s.updated_at,
    url: `${base}/api/v1/skills/${s.name}`,
    raw_url: `${base}/api/v1/skills/${s.name}?format=raw`,
    bundle_url: `${base}/api/v1/skills/${s.name}/bundle`,
    install_url: `${base}/api/v1/skills/${s.name}/install`,
  }));
  return Response.json({ skills });
}

// POST /api/v1/skills — create or update a skill.
//   { name, description, body, files?, frontmatter? }
//   or { skill_md, files? }  — raw SKILL.md, parsed server-side
// `body` is the SKILL.md body (Instructions). Send the whole SKILL.md as
// `skill_md` and the server splits out name/description/body and preserves any
// extra frontmatter keys (e.g. a custom `references:` list). `files` is the
// optional bundle of extras — Scripts, References, Assets — each
// { path, content, executable? }; when present it REPLACES the existing set.
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  let body: {
    name?: string;
    description?: string;
    body?: string;
    skill_md?: string;
    frontmatter?: string;
    files?: SkillFileInput[];
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // When a raw SKILL.md is sent, parse it; explicit fields still win.
  const parsed =
    typeof body.skill_md === "string" ? parseSkillMd(body.skill_md) : null;

  const rawName =
    typeof body.name === "string" ? body.name : parsed?.name ?? "";
  const name = rawName.trim().toLowerCase();
  if (!SKILL_NAME_RE.test(name)) {
    return Response.json(
      { error: "name is required (kebab-case: lowercase letters, numbers, hyphens)" },
      { status: 400 }
    );
  }

  const description =
    typeof body.description === "string"
      ? body.description.trim()
      : (parsed?.description ?? "").trim();

  const bodyMd =
    typeof body.body === "string" ? body.body : parsed?.body ?? "";
  if (!bodyMd.trim()) {
    return Response.json(
      { error: "body (the SKILL.md markdown) is required — or send skill_md" },
      { status: 400 }
    );
  }

  const extraFrontmatter =
    typeof body.frontmatter === "string"
      ? body.frontmatter
      : parsed?.extraFrontmatter ?? "";

  // Validate file paths up front so a bad bundle is rejected before any write.
  let files: SkillFileInput[] | undefined;
  if (body.files !== undefined) {
    if (!Array.isArray(body.files)) {
      return Response.json(
        { error: "files must be an array of { path, content }" },
        { status: 400 }
      );
    }
    for (const f of body.files) {
      if (!f || typeof f.path !== "string" || !isSafeSkillPath(f.path.trim())) {
        return Response.json(
          { error: `Invalid file path: ${f?.path}. Use a relative path like scripts/run.sh (no "..", no leading "/", not SKILL.md).` },
          { status: 400 }
        );
      }
      if (f.content !== undefined && typeof f.content !== "string") {
        return Response.json(
          { error: `File ${f.path}: content must be a string` },
          { status: 400 }
        );
      }
    }
    files = body.files.map((f) => ({
      path: f.path.trim(),
      content: typeof f.content === "string" ? f.content : "",
      executable: f.executable === true,
    }));
  }

  const skill = await upsertSkill(
    {
      name,
      description,
      body: bodyMd,
      extra_frontmatter: extraFrontmatter,
    },
    caller.ownerId
  );

  const savedFiles = files
    ? await replaceSkillFiles(skill.id, files)
    : undefined;

  return Response.json(
    {
      skill,
      skill_md: buildSkillMd(skill),
      ...(savedFiles
        ? { files: savedFiles.map((f) => ({ path: f.path, executable: f.executable })) }
        : {}),
    },
    { status: 201 }
  );
}
