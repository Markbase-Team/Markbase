// The database half of @markbase/shared/project-docs: every query here runs on the web
// server with the secret key. The shapes these return stay in @markbase/shared.

import { supabase } from "../supabase";
import type {
  ProjectDoc,
  CreateProjectDocInput,
  UpdateProjectDocInput,
} from "@markbase/shared/project-docs";

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
