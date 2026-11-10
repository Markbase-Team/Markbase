import { supabase } from "@markbase/protocol/supabase";

export interface LearningDiary {
  id: string;
  /** The day being journaled, as YYYY-MM-DD. */
  entry_date: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

// All diary entries, sorted by date (newest first), then newest-created within
// the same day — matching the learning_diaries_order_idx.
export async function listDiaries(
  ownerId: string
): Promise<LearningDiary[]> {
  const { data, error } = await supabase
    .from("learning_diaries")
    .select("*")
    .eq("owner_id", ownerId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LearningDiary[];
}

export async function getDiary(
  id: string,
  ownerId: string
): Promise<LearningDiary | undefined> {
  const { data, error } = await supabase
    .from("learning_diaries")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as LearningDiary | undefined;
}

export interface CreateDiaryInput {
  /** YYYY-MM-DD. Defaults to the database's current_date when omitted. */
  entry_date?: string;
  title?: string;
  content?: string;
}

export async function createDiary(
  input: CreateDiaryInput,
  ownerId: string
): Promise<LearningDiary> {
  const row: CreateDiaryInput & { owner_id: string } = {
    title: input.title ?? "",
    content: input.content ?? "",
    owner_id: ownerId,
  };
  // Omit entry_date when unset so the column default (current_date) applies.
  if (input.entry_date) row.entry_date = input.entry_date;

  const { data, error } = await supabase
    .from("learning_diaries")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data as LearningDiary;
}

export interface UpdateDiaryInput {
  entry_date?: string;
  title?: string;
  content?: string;
}

export async function updateDiary(
  id: string,
  input: UpdateDiaryInput,
  ownerId: string
): Promise<LearningDiary | undefined> {
  const patch: UpdateDiaryInput & { updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (typeof input.entry_date === "string") patch.entry_date = input.entry_date;
  if (typeof input.title === "string") patch.title = input.title;
  if (typeof input.content === "string") patch.content = input.content;

  const { data, error } = await supabase
    .from("learning_diaries")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as LearningDiary | undefined;
}

export async function deleteDiary(id: string, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from("learning_diaries")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}
