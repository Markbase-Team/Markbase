import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverSupabaseKey } from "@markbase/protocol/supabase";

// Secret-key Supabase client for the email module. The email tables (which
// hold OAuth tokens) have RLS that denies the publishable/anon key, so this
// module MUST use the secret key. Created lazily so importing the module
// (e.g. for the OAuth URL builder) doesn't require DB env to be present.
let client: SupabaseClient | null = null;

export function getEmailDb(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = serverSupabaseKey();
  if (!url || !key) {
    throw new Error(
      "@markbase/email needs SUPABASE_URL + SUPABASE_SECRET_KEY " +
        "(the secret key); email tables deny the publishable key"
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
