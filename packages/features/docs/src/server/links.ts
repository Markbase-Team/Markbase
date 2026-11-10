import { randomBytes } from "node:crypto";
import { supabase } from "@markbase/protocol/supabase";
import type { Capability } from "./auth";

// Shareable links. A `member` link requires sign-in and grants a doc_members
// capability on first open (persistent, named collaborator). A `guest` link
// opens the anonymous review surface with its capability (comment/suggest/view),
// no account. The owner mints and revokes these.

const db = () => supabase.schema("docs");

export type LinkMode = "member" | "guest";

export interface LinkRow {
  id: string;
  doc_id: string;
  token: string;
  mode: LinkMode;
  capability: Capability;
  created_at: string;
  revoked_at: string | null;
}

function generateToken(): string {
  return randomBytes(18).toString("base64url"); // ~24 URL-safe chars
}

export async function createLink(input: {
  docId: string;
  mode: LinkMode;
  capability: Capability;
  createdBy: string;
}): Promise<LinkRow> {
  const { data, error } = await db()
    .from("links")
    .insert({
      doc_id: input.docId,
      token: generateToken(),
      mode: input.mode,
      capability: input.capability,
      created_by: input.createdBy,
    })
    .select("id, doc_id, token, mode, capability, created_at, revoked_at")
    .single();
  if (error) throw error;
  return data as LinkRow;
}

export async function listLinks(docId: string): Promise<LinkRow[]> {
  const { data, error } = await db()
    .from("links")
    .select("id, doc_id, token, mode, capability, created_at, revoked_at")
    .eq("doc_id", docId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LinkRow[];
}

/** Resolve an active (non-revoked) link by its token. */
export async function getLinkByToken(token: string): Promise<LinkRow | null> {
  const { data, error } = await db()
    .from("links")
    .select("id, doc_id, token, mode, capability, created_at, revoked_at")
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as LinkRow | null) ?? null;
}

export async function revokeLink(id: string, docId: string): Promise<void> {
  const { error } = await db()
    .from("links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("doc_id", docId);
  if (error) throw error;
}
