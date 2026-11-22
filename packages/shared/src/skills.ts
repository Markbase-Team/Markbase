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

export interface UpsertSkillInput {
  name: string;
  description?: string;
  body?: string;
  extra_frontmatter?: string;
}
