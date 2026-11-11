import { randomBytes, timingSafeEqual } from "node:crypto";
import { joinLink } from "@markbase/protocol/instance";
import { supabase } from "@markbase/protocol/supabase";
import { instanceUrl } from "@/lib/instance-url";

// The instance's invite code: what its join link carries, and what the join
// page checks before it offers to create an account.
//
// A self-hosted instance is invite-only. There is no admin role yet — anyone
// already on the team can share the link from Settings — so the code is the
// whole gate, and rotating it is how a leaked link is revoked. One row, the
// API's alone (supabase/migrations/20261104210000_instance_invite.sql): every
// read and write here runs on the secret key.

const TABLE = "instance_settings";

/** One row's worth of the table, as this reads it. */
interface InviteRow {
  invite_code: string;
  admin_user_id: string | null;
}

function newCode(): string {
  return randomBytes(12).toString("base64url");
}

async function readCode(): Promise<string | null> {
  const { data, error } = await supabase.from(TABLE).select("invite_code").eq("singleton", true).maybeSingle();
  if (error) throw new Error(`instance_settings: ${error.message}`);
  const row = data as InviteRow | null;
  return row?.invite_code ?? null;
}

/** The current code, creating the row with a fresh one the first time anyone asks. */
export async function inviteCode(): Promise<string> {
  const existing = await readCode();
  if (existing) return existing;
  const code = newCode();
  const { error } = await supabase.from(TABLE).insert({ singleton: true, invite_code: code });
  // Two first readers at once: the second insert hits the primary key, and the
  // first one's code is the instance's.
  if (error && error.code !== "23505") throw new Error(`instance_settings: ${error.message}`);
  return error ? ((await readCode()) ?? code) : code;
}

/** A new code; every link carrying the old one stops admitting people. */
export async function rotateInviteCode(): Promise<string> {
  await inviteCode();
  const code = newCode();
  const { error } = await supabase
    .from(TABLE)
    .update({ invite_code: code, invite_rotated_at: new Date().toISOString() })
    .eq("singleton", true);
  if (error) throw new Error(`instance_settings: ${error.message}`);
  return code;
}

/** Whether `code` is the instance's current invite code. */
export async function verifyInviteCode(code: string | null | undefined): Promise<boolean> {
  if (!code) return false;
  const current = Buffer.from(await inviteCode());
  const given = Buffer.from(code);
  return current.length === given.length && timingSafeEqual(current, given);
}

/**
 * Create the invited person's account. The join route has checked that they
 * may: the invite vouches for them, so the address needs no confirmation
 * mail. Created with the secret key, which is also what lets an instance turn
 * public sign-up off in its Supabase project (SELF-HOSTING.md) and still admit
 * people through the link.
 *
 * `first`: this is the instance's first account — the person who set it up —
 * and it is recorded as the admin.
 */
export async function createInvitedUser(
  email: string,
  password: string,
  first = false
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return { ok: false, error: error.message };
  await markJoined(email);
  if (first && data.user) await recordAdmin(data.user.id);
  return { ok: true };
}

/** The first account is the admin; written once, never over an existing one. */
async function recordAdmin(userId: string): Promise<void> {
  await inviteCode(); // the row exists after this
  await supabase.from(TABLE).update({ admin_user_id: userId }).eq("singleton", true).is("admin_user_id", null);
}

/** Whether `userId` is the account that set this instance up. */
export async function isInstanceAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from(TABLE).select("admin_user_id").eq("singleton", true).maybeSingle();
  if (error) throw new Error(`instance_settings: ${error.message}`);
  const row = data as Pick<InviteRow, "admin_user_id"> | null;
  return row?.admin_user_id === userId;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITES = "instance_invites";

/** One address on the invite list, as Settings shows it. */
export interface PendingInvite {
  email: string;
  created_at: string;
}

/** A row of the list, as this reads it. */
interface InviteListRow {
  email: string;
  created_at: string;
  accepted_at: string | null;
}

function normalizeEmail(email: string): string | null {
  const address = email.trim().toLowerCase();
  return EMAIL.test(address) ? address : null;
}

/**
 * Put an address on the list. Nothing is sent: the member who adds it hands
 * the teammate the join link, and the join page admits that address. Adding
 * one that is already on the list is fine; one that already joined is not,
 * because the account exists and the link has nothing to do for it.
 */
export async function addInvite(
  email: string,
  invitedBy: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const address = normalizeEmail(email);
  if (!address) return { ok: false, error: "That does not look like an email address." };
  const { error } = await supabase.from(INVITES).insert({ email: address, invited_by: invitedBy });
  if (!error) return { ok: true };
  if (error.code !== "23505") return { ok: false, error: `instance_invites: ${error.message}` };
  const { data } = await supabase.from(INVITES).select("accepted_at").eq("email", address).maybeSingle();
  const row = data as Pick<InviteListRow, "accepted_at"> | null;
  return row?.accepted_at
    ? { ok: false, error: `${address} already has an account here.` }
    : { ok: true };
}

/** Take an address off the list. An address that already joined stays, as the record of it. */
export async function removeInvite(email: string): Promise<void> {
  const address = normalizeEmail(email);
  if (!address) return;
  const { error } = await supabase.from(INVITES).delete().eq("email", address).is("accepted_at", null);
  if (error) throw new Error(`instance_invites: ${error.message}`);
}

/** The addresses invited and not yet joined, oldest first. */
export async function pendingInvites(): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from(INVITES)
    .select("email, created_at")
    .is("accepted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`instance_invites: ${error.message}`);
  return (data as PendingInvite[] | null) ?? [];
}

/** Whether the join page may create an account for this address. */
export async function isInvited(email: string): Promise<boolean> {
  const address = normalizeEmail(email);
  if (!address) return false;
  const { data, error } = await supabase
    .from(INVITES)
    .select("email")
    .eq("email", address)
    .is("accepted_at", null)
    .maybeSingle();
  if (error) throw new Error(`instance_invites: ${error.message}`);
  return data !== null;
}

async function markJoined(email: string): Promise<void> {
  const address = normalizeEmail(email);
  if (!address) return;
  await supabase.from(INVITES).update({ accepted_at: new Date().toISOString() }).eq("email", address);
}

/**
 * A fresh instance has nobody to invite its first account, so until one
 * exists the join link admits whoever opens it — the person who just read
 * the link off the server's log.
 */
export async function instanceHasAccounts(): Promise<boolean> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error(`auth: ${error.message}`);
  return data.users.length > 0;
}

/**
 * Whether the instance is known to have no accounts — for the pages that
 * decide between the admin's set-up and the ordinary sign-in.
 *
 * A check that fails reads as "not known to be empty". Every instance but a
 * brand-new one has accounts, so the ordinary sign-in is right for all of them,
 * and a database that is briefly unreachable must not turn the sign-in page
 * into an error page (the desktop app shows it in its window, and an instance
 * whose network address changed did exactly that, 2026-11-10).
 */
export async function instanceKnownEmpty(): Promise<boolean> {
  try {
    return !(await instanceHasAccounts());
  } catch (e) {
    console.warn(`[invite] could not tell whether the instance has accounts: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** verifyInviteCode for a page: a database that cannot be reached is "not verified", not a crash. */
export async function verifyInviteCodeForPage(code: string | null | undefined): Promise<boolean> {
  try {
    return await verifyInviteCode(code);
  } catch (e) {
    console.warn(`[invite] could not check the invite code: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

/** What Settings shows a member to share. */
export interface InviteInfo {
  /** The join page with the current invite code — the link to hand on. */
  join_url: string;
  /** Who has been added and has not joined yet. */
  pending: PendingInvite[];
  /** Whether the caller is the account that set this instance up. */
  admin: boolean;
}

export async function inviteInfo(callerId: string): Promise<InviteInfo> {
  const [url, code, pending, admin] = await Promise.all([
    instanceUrl(),
    inviteCode(),
    pendingInvites(),
    isInstanceAdmin(callerId),
  ]);
  return { join_url: joinLink(url, code), pending, admin };
}
