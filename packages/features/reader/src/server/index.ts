import { supabase } from "@markbase/protocol/supabase";

export interface ReaderDocument {
  id: string;
  name: string;
  path: string;
  url: string;
  /** Last page the reader was viewing; reopening jumps here. */
  last_page: number;
  created_at: string;
}

export interface ReaderMessage {
  id: string;
  selection_id: string;
  question: string;
  answer: string;
  created_at: string;
}

export interface ReaderSelection {
  id: string;
  document_id: string;
  page: number;
  /** Editable toggle title; empty falls back to the text/"Image selection". */
  title: string;
  text: string;
  /** For area selections: cropped page region in the reader-pdfs bucket. */
  image_url: string | null;
  position: number;
  created_at: string;
}

// A selection with its Q&A thread attached (for loading a document).
export interface ReaderSelectionWithMessages extends ReaderSelection {
  messages: ReaderMessage[];
}

// ----- Documents -----------------------------------------------------------

export async function listReaderDocuments(): Promise<ReaderDocument[]> {
  const { data, error } = await supabase
    .from("reader_documents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ReaderDocument[];
}

export async function getReaderDocument(
  id: string
): Promise<ReaderDocument | undefined> {
  const { data, error } = await supabase
    .from("reader_documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as ReaderDocument | undefined;
}

export async function createReaderDocument(input: {
  name: string;
  path: string;
  url: string;
}): Promise<ReaderDocument> {
  const { data, error } = await supabase
    .from("reader_documents")
    .insert({ name: input.name, path: input.path, url: input.url })
    .select("*")
    .single();
  if (error) throw error;
  return data as ReaderDocument;
}

export async function deleteReaderDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from("reader_documents")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Persist the last page the reader was viewing for this document.
export async function setReaderDocumentLastPage(
  id: string,
  page: number
): Promise<void> {
  const { error } = await supabase
    .from("reader_documents")
    .update({ last_page: page })
    .eq("id", id);
  if (error) throw error;
}

// ----- Highlights ----------------------------------------------------------

// A page-normalized box (0..1) so highlights redraw at any rendered page size.
export interface HighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReaderHighlight {
  id: string;
  document_id: string;
  page: number;
  rects: HighlightRect[];
  color: string;
  text: string;
  created_at: string;
}

export async function listReaderHighlights(
  documentId: string
): Promise<ReaderHighlight[]> {
  const { data, error } = await supabase
    .from("reader_highlights")
    .select("*")
    .eq("document_id", documentId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ReaderHighlight[];
}

export async function createReaderHighlight(input: {
  document_id: string;
  page: number;
  rects: HighlightRect[];
  color?: string;
  text?: string;
}): Promise<ReaderHighlight> {
  const { data, error } = await supabase
    .from("reader_highlights")
    .insert({
      document_id: input.document_id,
      page: input.page,
      rects: input.rects,
      color: input.color ?? "yellow",
      text: input.text ?? "",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ReaderHighlight;
}

export async function deleteReaderHighlight(id: string): Promise<void> {
  const { error } = await supabase
    .from("reader_highlights")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ----- Selections + messages ----------------------------------------------

// A document's selections, each with its Q&A thread, in display order.
export async function listReaderSelections(
  documentId: string
): Promise<ReaderSelectionWithMessages[]> {
  const { data: selections, error } = await supabase
    .from("reader_selections")
    .select("*")
    .eq("document_id", documentId)
    .order("position")
    .order("created_at");
  if (error) throw error;
  const rows = (selections ?? []) as ReaderSelection[];
  if (rows.length === 0) return [];

  const { data: messages, error: msgError } = await supabase
    .from("reader_messages")
    .select("*")
    .in(
      "selection_id",
      rows.map((s) => s.id)
    )
    .order("created_at");
  if (msgError) throw msgError;

  const bySelection = new Map<string, ReaderMessage[]>();
  for (const m of (messages ?? []) as ReaderMessage[]) {
    const arr = bySelection.get(m.selection_id) ?? [];
    arr.push(m);
    bySelection.set(m.selection_id, arr);
  }
  return rows.map((s) => ({ ...s, messages: bySelection.get(s.id) ?? [] }));
}

export async function getReaderSelection(
  id: string
): Promise<ReaderSelection | undefined> {
  const { data, error } = await supabase
    .from("reader_selections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as ReaderSelection | undefined;
}

export async function createReaderSelection(input: {
  document_id: string;
  page: number;
  text?: string;
  image_url?: string | null;
  position: number;
}): Promise<ReaderSelection> {
  const { data, error } = await supabase
    .from("reader_selections")
    .insert({
      document_id: input.document_id,
      page: input.page,
      text: input.text ?? "",
      image_url: input.image_url ?? null,
      position: input.position,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ReaderSelection;
}

export async function updateReaderSelection(
  id: string,
  input: { text?: string; title?: string }
): Promise<ReaderSelection | undefined> {
  const patch: { text?: string; title?: string } = {};
  if (typeof input.text === "string") patch.text = input.text;
  if (typeof input.title === "string") patch.title = input.title;
  if (Object.keys(patch).length === 0) return getReaderSelection(id);
  const { data, error } = await supabase
    .from("reader_selections")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as ReaderSelection | undefined;
}

export async function deleteReaderSelection(id: string): Promise<void> {
  const { error } = await supabase
    .from("reader_selections")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function deleteReaderMessage(id: string): Promise<void> {
  const { error } = await supabase
    .from("reader_messages")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function addReaderMessage(input: {
  selection_id: string;
  question: string;
  answer: string;
}): Promise<ReaderMessage> {
  const { data, error } = await supabase
    .from("reader_messages")
    .insert({
      selection_id: input.selection_id,
      question: input.question,
      answer: input.answer,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ReaderMessage;
}
