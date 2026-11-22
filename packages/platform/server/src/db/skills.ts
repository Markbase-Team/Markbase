// The database half of @markbase/shared/skills: every query here runs on the web
// server with the secret key. The shapes these return stay in @markbase/shared.

import { supabase } from "../supabase";
import type { Skill, UpsertSkillInput } from "@markbase/shared/skills";

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
