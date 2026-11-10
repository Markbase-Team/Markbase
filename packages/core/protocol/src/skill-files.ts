import { supabase } from "./supabase";

export interface SkillFile {
  id: string;
  skill_id: string;
  /** Relative POSIX path inside the skill dir, e.g. "scripts/validate.sh". */
  path: string;
  /** UTF-8 text content. */
  content: string;
  /** chmod +x on install (scripts) → mode 0755 vs 0644 in the bundle. */
  executable: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkillFileInput {
  path: string;
  content?: string;
  executable?: boolean;
}

// A safe relative path: POSIX separators, no leading slash, no "." / ".."
// segments, no backslashes or control chars. Guards the installer (which writes
// each path under the skill dir) against traversal, and keeps SKILL.md reserved
// for the skill's own body.
export function isSafeSkillPath(path: string): boolean {
  if (typeof path !== "string") return false;
  const p = path.trim();
  if (!p || p.length > 255) return false;
  if (p.startsWith("/") || p.includes("\\")) return false;
  // Reject control characters and spaces in paths.
  if (/[\x00-\x1f ]/.test(p)) return false;
  const segments = p.split("/");
  return segments.every(
    (seg) => seg.length > 0 && seg !== "." && seg !== ".." && seg !== "SKILL.md"
  );
}

// True when the error is "the skill_files table doesn't exist yet" — i.e. the
// migration hasn't run. Lets read paths degrade to "no files" so the rest of
// the skills API keeps working before the table is created.
function isMissingTable(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" || // postgres: undefined_table
    error.code === "PGRST205" || // postgrest: table not in schema cache
    (/skill_files/.test(error.message ?? "") &&
      /(does not exist|schema cache)/.test(error.message ?? ""))
  );
}

export async function listSkillFiles(skillId: string): Promise<SkillFile[]> {
  const { data, error } = await supabase
    .from("skill_files")
    .select("*")
    .eq("skill_id", skillId)
    .order("path");
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []) as SkillFile[];
}

export async function getSkillFile(
  id: string
): Promise<SkillFile | undefined> {
  const { data, error } = await supabase
    .from("skill_files")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as SkillFile | undefined;
}

// Create a file, or replace the content/mode of the one at the same path.
export async function upsertSkillFile(
  skillId: string,
  input: SkillFileInput
): Promise<SkillFile> {
  const path = input.path.trim();
  if (!isSafeSkillPath(path)) {
    throw new Error(`Invalid skill file path: ${input.path}`);
  }
  const { data, error } = await supabase
    .from("skill_files")
    .upsert(
      {
        skill_id: skillId,
        path,
        content: input.content ?? "",
        executable: input.executable ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "skill_id,path" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as SkillFile;
}

export async function updateSkillFile(
  id: string,
  input: { path?: string; content?: string; executable?: boolean }
): Promise<SkillFile | undefined> {
  const patch: {
    path?: string;
    content?: string;
    executable?: boolean;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };
  if (typeof input.path === "string") {
    const path = input.path.trim();
    if (!isSafeSkillPath(path)) {
      throw new Error(`Invalid skill file path: ${input.path}`);
    }
    patch.path = path;
  }
  if (typeof input.content === "string") patch.content = input.content;
  if (typeof input.executable === "boolean") patch.executable = input.executable;

  const { data, error } = await supabase
    .from("skill_files")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as SkillFile | undefined;
}

export async function deleteSkillFile(id: string): Promise<void> {
  const { error } = await supabase.from("skill_files").delete().eq("id", id);
  if (error) throw error;
}

// Replace a skill's entire file set in one call (used by the multi-file publish
// API): upsert every provided path, then delete any rows no longer present.
export async function replaceSkillFiles(
  skillId: string,
  files: SkillFileInput[]
): Promise<SkillFile[]> {
  for (const f of files) {
    if (!isSafeSkillPath((f.path ?? "").trim())) {
      throw new Error(`Invalid skill file path: ${f.path}`);
    }
  }
  const keepPaths = new Set(files.map((f) => f.path.trim()));
  const existing = await listSkillFiles(skillId);
  const stale = existing.filter((e) => !keepPaths.has(e.path));

  for (const f of files) {
    await upsertSkillFile(skillId, f);
  }
  if (stale.length > 0) {
    const { error } = await supabase
      .from("skill_files")
      .delete()
      .in(
        "id",
        stale.map((s) => s.id)
      );
    if (error) throw error;
  }
  return listSkillFiles(skillId);
}
