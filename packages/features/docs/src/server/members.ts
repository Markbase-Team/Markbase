import { supabase } from "@markbase/protocol/supabase";
import type { Capability } from "./auth";

// Data layer for docs.members — the authenticated collaborators on a doc and
// their capability. `member` links create rows here on first open.

const db = () => supabase.schema("docs");

const MEMBER_CAPS = new Set(["editor", "commenter", "viewer"]);

function isMemberCapability(c: string): c is Capability {
  return MEMBER_CAPS.has(c);
}

/** The user's member capability on a doc, or null if they aren't a member. */
export async function getMemberCapability(
  docId: string,
  userId: string
): Promise<Capability | null> {
  const { data, error } = await db()
    .from("members")
    .select("capability")
    .eq("doc_id", docId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const cap = data?.capability;
  return typeof cap === "string" && isMemberCapability(cap) ? cap : null;
}

/**
 * Grant a user a capability on a doc (idempotent). Never downgrades an existing
 * higher grant — opening a commenter link doesn't strip your editor access.
 */
export async function grantMember(input: {
  docId: string;
  userId: string;
  capability: Capability;
  invitedBy?: string;
}): Promise<void> {
  const existing = await getMemberCapability(input.docId, input.userId);
  if (existing === "owner") return;
  if (existing && rank(existing) >= rank(input.capability)) return;

  const { error } = await db()
    .from("members")
    .upsert(
      {
        doc_id: input.docId,
        user_id: input.userId,
        capability: input.capability,
        invited_by: input.invitedBy ?? null,
      },
      { onConflict: "doc_id,user_id" }
    );
  if (error) throw error;
}

function rank(c: Capability): number {
  return { viewer: 1, commenter: 2, editor: 3, owner: 4 }[c];
}

export interface MemberRow {
  id: string;
  doc_id: string;
  user_id: string;
  capability: Capability;
  created_at: string;
}

export async function listMembers(docId: string): Promise<MemberRow[]> {
  const { data, error } = await db()
    .from("members")
    .select("id, doc_id, user_id, capability, created_at")
    .eq("doc_id", docId);
  if (error) throw error;
  return (data ?? []) as MemberRow[];
}

/**
 * What one user holds on one document: their capability, and where they file
 * it in their Shared Vault. Null when they are not a member — the owner has no
 * row, and neither does a stranger.
 */
export interface Membership {
  capability: Capability;
  /** The member's own path inside their Shared Vault; null = the default layout. */
  path: string | null;
}

export async function getMembership(docId: string, userId: string): Promise<Membership | null> {
  const { data, error } = await db()
    .from("members")
    .select("capability, path")
    .eq("doc_id", docId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const cap = data?.capability;
  if (typeof cap !== "string" || !isMemberCapability(cap)) return null;
  return { capability: cap, path: typeof data?.path === "string" ? data.path : null };
}

/** Every document `userId` is a member of, with their capability and path on each. */
export async function listMembershipsForUser(
  userId: string
): Promise<Array<Membership & { docId: string }>> {
  const { data, error } = await db()
    .from("members")
    .select("doc_id, capability, path")
    .eq("user_id", userId);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ doc_id: string; capability: string; path: string | null }>;
  return rows
    .filter((r) => isMemberCapability(r.capability))
    .map((r) => ({
      docId: r.doc_id,
      capability: r.capability as Capability,
      path: typeof r.path === "string" ? r.path : null,
    }));
}

/**
 * Where a member files a shared document in THEIR Shared Vault. Theirs alone:
 * the owner's `documents.path` is untouched, and so is every other member's.
 * Null puts it back on the default layout. Returns false when there is no
 * membership to write to.
 */
export async function setMemberPath(
  docId: string,
  userId: string,
  path: string | null
): Promise<boolean> {
  const { data, error } = await db()
    .from("members")
    .update({ path })
    .eq("doc_id", docId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Leave a share: drop the member's own row. The document is untouched — this
 * is what a member's daemon does when they delete the file, since a member can
 * never delete the document itself. Returns false when there was no row.
 */
export async function removeMember(docId: string, userId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("members")
    .delete()
    .eq("doc_id", docId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
