import { supabase } from "@markbase/protocol/supabase";

export interface Term {
  id: string;
  term: string;
  definition: string;
  created_at: string;
}

export interface TermMessage {
  id: string;
  term_id: string;
  question: string;
  answer: string;
  created_at: string;
}

export interface TermWithMessages extends Term {
  messages: TermMessage[];
}

// All terms (newest first), each with its Q&A thread.
export async function listTerms(): Promise<TermWithMessages[]> {
  const { data: terms, error } = await supabase
    .from("terms")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (terms ?? []) as Term[];
  if (rows.length === 0) return [];

  const { data: messages, error: msgError } = await supabase
    .from("term_messages")
    .select("*")
    .in(
      "term_id",
      rows.map((t) => t.id)
    )
    .order("created_at");
  if (msgError) throw msgError;

  const byTerm = new Map<string, TermMessage[]>();
  for (const m of (messages ?? []) as TermMessage[]) {
    const arr = byTerm.get(m.term_id) ?? [];
    arr.push(m);
    byTerm.set(m.term_id, arr);
  }
  return rows.map((t) => ({ ...t, messages: byTerm.get(t.id) ?? [] }));
}

export async function getTerm(id: string): Promise<Term | undefined> {
  const { data, error } = await supabase
    .from("terms")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Term | undefined;
}

export async function createTerm(input: {
  term: string;
  definition: string;
}): Promise<Term> {
  const { data, error } = await supabase
    .from("terms")
    .insert({ term: input.term, definition: input.definition })
    .select("*")
    .single();
  if (error) throw error;
  return data as Term;
}

export async function deleteTerm(id: string): Promise<void> {
  const { error } = await supabase.from("terms").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteTermMessage(id: string): Promise<void> {
  const { error } = await supabase
    .from("term_messages")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function addTermMessage(input: {
  term_id: string;
  question: string;
  answer: string;
}): Promise<TermMessage> {
  const { data, error } = await supabase
    .from("term_messages")
    .insert({
      term_id: input.term_id,
      question: input.question,
      answer: input.answer,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as TermMessage;
}
