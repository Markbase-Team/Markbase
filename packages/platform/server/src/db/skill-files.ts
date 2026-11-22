// The database half of @markbase/shared/skill-files: every query here runs on the web
// server with the secret key. The shapes these return stay in @markbase/shared.

import { supabase } from "../supabase";
import {
  type SkillFile,
  type SkillFileInput,
  isSafeSkillPath,
} from "@markbase/shared/skill-files";

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
