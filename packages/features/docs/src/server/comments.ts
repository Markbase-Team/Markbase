import { supabase } from "@markbase/protocol/supabase";
import type { Author } from "../logic/types";

// Anchored review comments. A root comment pins to a text range (positions +
// the quoted text as a durable fallback); replies carry a parent_id and no
// anchor. Sidecar to the document — the markdown/steps are never touched.

const db = () => supabase.schema("docs");

const COLS =
  "id, doc_id, parent_id, anchor_from, anchor_to, anchor_version, quoted_text, body, author_kind, author_id, author_name, resolved, created_at";

export interface CommentRow {
  id: string;
  doc_id: string;
  parent_id: string | null;
  anchor_from: number;
  anchor_to: number;
  anchor_version: number;
  quoted_text: string;
  body: string;
  author_kind: string;
  author_id: string | null;
  author_name: string;
  resolved: boolean;
  created_at: string;
}

export async function listComments(docId: string): Promise<CommentRow[]> {
  const { data, error } = await db()
    .from("comments")
    .select(COLS)
    .eq("doc_id", docId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CommentRow[];
}

export async function createComment(input: {
  docId: string;
  parentId?: string | null;
  anchorFrom?: number;
  anchorTo?: number;
  anchorVersion?: number;
  quotedText?: string;
  body: string;
  author: Author;
}): Promise<CommentRow> {
  const { data, error } = await db()
    .from("comments")
    .insert({
      doc_id: input.docId,
      parent_id: input.parentId ?? null,
      anchor_from: input.anchorFrom ?? 0,
      anchor_to: input.anchorTo ?? 0,
      anchor_version: input.anchorVersion ?? 0,
      quoted_text: input.quotedText ?? "",
      body: input.body,
      author_kind: input.author.kind,
      author_id: input.author.id ?? null,
      author_name: input.author.name,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return data as CommentRow;
}

/** Resolve/unresolve a thread by marking its root comment. */
export async function setCommentResolved(
  docId: string,
  commentId: string,
  resolved: boolean
): Promise<void> {
  const { error } = await db()
    .from("comments")
    .update({ resolved })
    .eq("id", commentId)
    .eq("doc_id", docId);
  if (error) throw error;
}
