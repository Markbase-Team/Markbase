import { supabase } from "./supabase";

export interface Skill {
  id: string;
  /** kebab-case slug: the skill's directory name and URL segment. */
  name: string;
  description: string;
  /** The SKILL.md body (markdown), without frontmatter. */
  body: string;
  /**
   * Verbatim frontmatter keys other than the managed name/description/version
   * (e.g. a custom `references:` list). Re-emitted by buildSkillMd so they
   * survive a publish/install round-trip. Empty for most skills.
   */
  extra_frontmatter: string;
  /** Bumped each time the body changes; stamped into the installed SKILL.md. */
  version: number;
  created_at: string;
  updated_at: string;
}

export const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Assemble the full SKILL.md an agent writes to <skills-dir>/<name>/SKILL.md.
// Frontmatter holds name + (single-line) description + version, then any
// preserved extra frontmatter, then the body.
export function buildSkillMd(
  skill: Pick<Skill, "name" | "description" | "body"> & {
    version?: number;
    extra_frontmatter?: string;
  }
): string {
  const description = skill.description.replace(/\r?\n/g, " ").trim();
  const versionLine = skill.version ? `version: ${skill.version}\n` : "";
  const extra = (skill.extra_frontmatter ?? "").trim();
  const extraLines = extra ? `${extra}\n` : "";
  return `---\nname: ${skill.name}\ndescription: ${description}\n${versionLine}${extraLines}---\n\n${skill.body.trim()}\n`;
}

// Split a full SKILL.md into the managed fields, the body, and any *extra*
// frontmatter (top-level keys other than name/description/version, kept
// verbatim — including multi-line list/map values). Lets a publisher send the
// raw file and have everything preserved.
export function parseSkillMd(raw: string): {
  name?: string;
  description?: string;
  body: string;
  extraFrontmatter: string;
} {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: raw.trim(), extraFrontmatter: "" };

  const body = raw.slice(m[0].length).replace(/^\r?\n+/, "");

  // Group frontmatter into top-level key blocks: a line `key:` at column 0
  // starts a block; indented/blank continuation lines belong to it.
  const blocks: { key: string; value: string; lines: string[] }[] = [];
  let cur: { key: string; value: string; lines: string[] } | null = null;
  for (const line of m[1].split("\n")) {
    const km = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (km && !/^\s/.test(line)) {
      cur = { key: km[1], value: km[2].trim(), lines: [line] };
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    }
  }

  let name: string | undefined;
  let description: string | undefined;
  const extra: string[] = [];
  for (const b of blocks) {
    if (b.key === "name") name = b.value;
    else if (b.key === "description") description = b.value;
    else if (b.key === "version") continue; // managed separately
    else extra.push(b.lines.join("\n"));
  }

  return {
    name,
    description,
    body,
    extraFrontmatter: extra.join("\n").trim(),
  };
}

// A skill is visible to its owner, plus public catalog skills are visible to
// everyone. ownerId is a validated uuid, safe to inline in the .or() filter.
function ownedOrPublic(ownerId: string): string {
  return `owner_id.eq.${ownerId},visibility.eq.public`;
}

export async function listSkills(ownerId: string): Promise<Skill[]> {
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .or(ownedOrPublic(ownerId))
    .order("name");
  if (error) throw error;
  return (data ?? []) as Skill[];
}

export async function getSkillById(
  id: string,
  ownerId: string
): Promise<Skill | undefined> {
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .eq("id", id)
    .or(ownedOrPublic(ownerId))
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Skill | undefined;
}

export async function getSkillByName(
  name: string,
  ownerId: string
): Promise<Skill | undefined> {
  const { data, error } = await supabase
    .from("skills")
    .select("*")
    .ilike("name", name)
    .or(ownedOrPublic(ownerId))
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Skill | undefined;
}

export interface UpsertSkillInput {
  name: string;
  description?: string;
  body?: string;
  extra_frontmatter?: string;
}

// Create a skill, or replace the body/description of one with the same name.
// Agents POST the same name to update; the UI does too. Scoped to the owner:
// upserting only ever touches the caller's own skill (never a public one).
export async function upsertSkill(
  input: UpsertSkillInput,
  ownerId: string
): Promise<Skill> {
  const { data: existingRow } = await supabase
    .from("skills")
    .select("*")
    .ilike("name", input.name)
    .eq("owner_id", ownerId)
    .maybeSingle();
  const existing = (existingRow ?? undefined) as Skill | undefined;
  if (existing) {
    const nextBody = input.body ?? existing.body;
    // Bump the version only when the body actually changes.
    const version =
      nextBody !== existing.body ? existing.version + 1 : existing.version;
    const { data, error } = await supabase
      .from("skills")
      .update({
        description: input.description ?? existing.description,
        body: nextBody,
        extra_frontmatter:
          input.extra_frontmatter ?? existing.extra_frontmatter,
        version,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as Skill;
  }
  const { data, error } = await supabase
    .from("skills")
    .insert({
      name: input.name,
      description: input.description ?? "",
      body: input.body ?? "",
      extra_frontmatter: input.extra_frontmatter ?? "",
      owner_id: ownerId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Skill;
}

export async function updateSkill(
  id: string,
  input: {
    name?: string;
    description?: string;
    body?: string;
    extra_frontmatter?: string;
  },
  ownerId: string
): Promise<Skill | undefined> {
  const { data: existingRow } = await supabase
    .from("skills")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!existingRow) return undefined;
  const existing = existingRow as Skill;

  const patch: {
    name?: string;
    description?: string;
    body?: string;
    extra_frontmatter?: string;
    version?: number;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };
  if (typeof input.name === "string") patch.name = input.name;
  if (typeof input.description === "string") patch.description = input.description;
  if (typeof input.extra_frontmatter === "string")
    patch.extra_frontmatter = input.extra_frontmatter;
  if (typeof input.body === "string") {
    patch.body = input.body;
    // Bump the version only when the body actually changes.
    if (input.body !== existing.body) patch.version = existing.version + 1;
  }
  const { data, error } = await supabase
    .from("skills")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Skill | undefined;
}

export async function deleteSkill(id: string, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from("skills")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}
