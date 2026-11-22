// The database half of @markbase/shared/todos: every query here runs on the web
// server with the secret key. The shapes these return stay in @markbase/shared.

import { supabase } from "../supabase";
import type { Todo } from "@markbase/shared/todos";

const TABLE = "today_todos";

// Todos for a single day, in manual (drag) order, created_at breaking ties.
// Scoped to the owner (todos are personal, per user).
export async function listTodos(day: string, ownerId: string): Promise<Todo[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("owner_id", ownerId)
    .eq("day", day)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as Todo[];
}

export async function getTodo(
  id: string,
  ownerId: string
): Promise<Todo | undefined> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Todo | undefined;
}

export async function createTodo(input: {
  text: string;
  day: string;
  ownerId: string;
}): Promise<Todo> {
  // Append after the owner's last todo for the day.
  const { data: last, error: maxError } = await supabase
    .from(TABLE)
    .select("position")
    .eq("owner_id", input.ownerId)
    .eq("day", input.day)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) throw maxError;
  const position = (last?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      text: input.text,
      day: input.day,
      position,
      owner_id: input.ownerId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Todo;
}

// Persist a new manual order for a day: write each id's index as its position.
export async function reorderTodos(
  day: string,
  orderedIds: string[],
  ownerId: string
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from(TABLE)
        .update({ position: index })
        .eq("id", id)
        .eq("day", day)
        .eq("owner_id", ownerId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

// Patch any subset of fields; absent fields are left unchanged.
export async function updateTodo(
  id: string,
  patch: { text?: string; done?: boolean; details?: string },
  ownerId: string
): Promise<Todo> {
  const update: { text?: string; done?: boolean; details?: string } = {};
  if (patch.text !== undefined) update.text = patch.text;
  if (patch.done !== undefined) update.done = patch.done;
  if (patch.details !== undefined) update.details = patch.details;

  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Todo;
}

export async function deleteTodo(id: string, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}
