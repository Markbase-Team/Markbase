import { supabase } from "@markbase/server/supabase";
import type { ActorRef, Confirmation } from "@markbase/shared/docs";

// Confirmations (docs.doc_confirmations): the one record a document's trust is
// worked out from. Written only here, by the API, as the signed-in caller;
// never from front matter, which anyone can type into.

const db = () => supabase.schema("docs").from("doc_confirmations");

export async function addConfirmation(input: {
  docId: string;
  userId: string;
  actor: ActorRef;
  version: number;
}): Promise<Confirmation> {
  const { data, error } = await db()
    .insert({ doc_id: input.docId, user_id: input.userId, actor: input.actor, version: input.version })
    .select("actor, created_at")
    .single();
  if (error) throw new Error(`Couldn't record the confirmation: ${error.message}`);
  return { by: data.actor as string, at: data.created_at as string };
}

/** Every confirmation of a document, oldest first. */
export async function listConfirmations(docId: string): Promise<Confirmation[]> {
  const { data, error } = await db()
    .select("actor, created_at")
    .eq("doc_id", docId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Couldn't read the document's confirmations: ${error.message}`);
  return (data ?? []).map((row) => ({ by: row.actor as string, at: row.created_at as string }));
}
