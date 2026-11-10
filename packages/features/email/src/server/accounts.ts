import { getEmailDb } from "./supabase";

// A connected Gmail account row. `refresh_token_enc` is the encrypted OAuth
// refresh token (see ./crypto) and must never reach the browser.
export type EmailAccount = {
  id: string;
  email_address: string;
  google_sub: string | null;
  display_name: string | null;
  refresh_token_enc: string;
  scopes: string[] | null;
};

// Safe projection for the client — no token, no internal fields.
export type EmailAccountPublic = {
  id: string;
  email_address: string;
  display_name: string | null;
};

export async function listEmailAccounts(): Promise<EmailAccountPublic[]> {
  const { data, error } = await getEmailDb()
    .from("email_accounts")
    .select("id, email_address, display_name")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getEmailAccount(
  id: string
): Promise<EmailAccount | null> {
  const { data, error } = await getEmailDb()
    .from("email_accounts")
    .select(
      "id, email_address, google_sub, display_name, refresh_token_enc, scopes"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export type UpsertEmailAccount = {
  email_address: string;
  google_sub: string | null;
  display_name: string | null;
  refresh_token_enc: string;
  scopes: string[] | null;
};

// Upsert on email_address so reconnecting the same account refreshes its token
// instead of creating a duplicate.
export async function upsertEmailAccount(
  input: UpsertEmailAccount
): Promise<void> {
  const { error } = await getEmailDb()
    .from("email_accounts")
    .upsert(
      { ...input, updated_at: new Date().toISOString() },
      { onConflict: "email_address" }
    );
  if (error) throw new Error(error.message);
}
