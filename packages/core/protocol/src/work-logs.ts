import { supabase } from "./supabase";

export interface WorkLog {
  id: string;
  /** The project (slug) this log belongs to. */
  project: string;
  /** YYYY-MM-DD, or null when the log is undated. */
  entry_date: string | null;
  title: string;
  content: string;
  position: number;
  created_at: string;
  updated_at: string;
}

// A project's logs. Undated logs sort first (treated as ongoing/current), then
// dated newest-first, with newest-created as the tiebreak.
export async function listWorkLogs(
  project: string,
  ownerId: string
): Promise<WorkLog[]> {
  const { data, error } = await supabase
    .from("work_logs")
    .select("*")
    .eq("project", project)
    .eq("owner_id", ownerId)
    .order("entry_date", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkLog[];
}

export async function getWorkLog(
  id: string,
  ownerId: string
): Promise<WorkLog | undefined> {
  const { data, error } = await supabase
    .from("work_logs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as WorkLog | undefined;
}

export interface CreateWorkLogInput {
  project: string;
  /** YYYY-MM-DD, or null/omitted for an undated log. */
  entry_date?: string | null;
  title?: string;
  content?: string;
}

export async function createWorkLog(
  input: CreateWorkLogInput
): Promise<WorkLog> {
  const { data, error } = await supabase
    .from("work_logs")
    .insert({
      project: input.project,
      entry_date: input.entry_date ?? null,
      title: input.title ?? "",
      content: input.content ?? "",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as WorkLog;
}

export interface UpdateWorkLogInput {
  /** Pass a string to date it, or null to make it undated. */
  entry_date?: string | null;
  title?: string;
  content?: string;
}

export async function updateWorkLog(
  id: string,
  input: UpdateWorkLogInput,
  ownerId: string
): Promise<WorkLog | undefined> {
  const patch: {
    entry_date?: string | null;
    title?: string;
    content?: string;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };
  // entry_date may be set to null (undated), so check for presence, not type.
  if (input.entry_date !== undefined) patch.entry_date = input.entry_date;
  if (typeof input.title === "string") patch.title = input.title;
  if (typeof input.content === "string") patch.content = input.content;

  const { data, error } = await supabase
    .from("work_logs")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as WorkLog | undefined;
}

export async function deleteWorkLog(
  id: string,
  ownerId: string
): Promise<void> {
  const { error } = await supabase
    .from("work_logs")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}
