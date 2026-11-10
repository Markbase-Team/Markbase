import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverSupabaseKey } from "@markbase/protocol/supabase";

// Secret-key Supabase client for the Attention module. The attention_* tables
// have RLS enabled with no policies, so they deny the publishable/anon key;
// only the secret key (which bypasses RLS) can read or write them. Created
// lazily so importing the module doesn't require DB env at load time.
let client: SupabaseClient | null = null;

export function getAttentionDb(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = serverSupabaseKey();
  if (!url || !key) {
    throw new Error(
      "@markbase/attention needs SUPABASE_URL + SUPABASE_SECRET_KEY " +
        "(the secret key); attention tables deny the publishable key"
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
