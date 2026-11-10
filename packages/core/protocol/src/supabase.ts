import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "./timeout-fetch";

// Server-side Supabase client used by the shared data layer.
//
// It runs with the project's SECRET key: since security lockdown stage 2 the
// API is the only reader and writer of the locked-down tables, and the
// publishable key is denied there. The key is resolved by `serverSupabaseKey`
// below, from whichever of its names the deployment set, and falls back to the
// publishable pair only so a build with no server env at all still constructs
// a client (RLS then answers what it will).
//
// The client is created LAZILY (on first use), not at import. Building this at
// module load would throw during `next build` page-data collection, where the
// transpiled package's NEXT_PUBLIC_* reads resolve to undefined. Deferring to
// first query means env is only required at request time (where it's present).
let client: SupabaseClient | null = null;
let override: { url: string; key: string } | null = null;

/**
 * The server's secret Supabase key, under any of the names a deployment may
 * use: `SUPABASE_KEY` (the name this code base grew up with), `SUPABASE_SECRET_KEY`
 * (what the Supabase dashboard calls it, and what SELF-HOSTING.md documents) or
 * `SUPABASE_SERVICE_ROLE_KEY` (the legacy JWT). One resolver for every module
 * that needs the secret — a self-hosted instance that set only the documented
 * name used to pass the publishable key to the document API and fail on every
 * locked table with 42501.
 */
export function serverSupabaseKey(): string | undefined {
  return (
    process.env.SUPABASE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Configure the client explicitly instead of reading env — used by the `markbase`
// CLI, which passes the public project URL + publishable key it bundles. The
// web app doesn't call this; it relies on the env fallback below.
export function configureSupabase(url: string, key: string): void {
  override = { url, key };
  client = null; // rebuild lazily with the new credentials
}

function getClient(): SupabaseClient {
  if (client) return client;
  const url =
    override?.url ??
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    override?.key ??
    serverSupabaseKey() ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase config: set SUPABASE_URL + SUPABASE_SECRET_KEY, " +
        "or NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false },
    // A database that stops answering must fail the call, not hang it — see timeout-fetch.
    global: { fetch: (input, init) => fetchWithTimeout(input, init) },
  });
  return client;
}

// Lazy proxy so existing `import { supabase }` + `supabase.from(...)` call sites
// keep working unchanged; the real client is built on first property access.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getClient();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
