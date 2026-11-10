import { supabase } from "./supabase";

// Per-project documentation: editable markdown docs scoped to a project (and its
// owner). Mirrors the work-logs data layer; docs are ordered oldest-first
// (creation order) so a project's docs read top-to-bottom.

export interface ProjectDoc {
  id: string;
  /** The project (slug) this doc belongs to. */
  project: string;
  title: string;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export async function listProjectDocs(
  project: string,
  ownerId: string
): Promise<ProjectDoc[]> {
  const { data, error } = await supabase
    .from("project_docs")
    .select("*")
    .eq("project", project)
    .eq("owner_id", ownerId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProjectDoc[];
}

export async function getProjectDoc(
  id: string,
  ownerId: string
): Promise<ProjectDoc | undefined> {
  const { data, error } = await supabase
    .from("project_docs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as ProjectDoc | undefined;
}

export interface CreateProjectDocInput {
  project: string;
  title?: string;
  content?: string;
}

export async function createProjectDoc(
  input: CreateProjectDocInput
): Promise<ProjectDoc> {
  const { data, error } = await supabase
    .from("project_docs")
    .insert({
      project: input.project,
      title: input.title ?? "",
      content: input.content ?? "",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ProjectDoc;
}

export interface UpdateProjectDocInput {
  title?: string;
  content?: string;
}

export async function updateProjectDoc(
  id: string,
  input: UpdateProjectDocInput,
  ownerId: string
): Promise<ProjectDoc | undefined> {
  const patch: {
    title?: string;
    content?: string;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };
  if (typeof input.title === "string") patch.title = input.title;
  if (typeof input.content === "string") patch.content = input.content;

  const { data, error } = await supabase
    .from("project_docs")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as ProjectDoc | undefined;
}

export async function deleteProjectDoc(
  id: string,
  ownerId: string
): Promise<void> {
  const { error } = await supabase
    .from("project_docs")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}
