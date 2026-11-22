import { createBrowserClient } from "@supabase/ssr";
import { instancePublicConfig } from "./instance-config";

// Singleton browser Supabase client. Returning a fresh client on every call
// spins up multiple GoTrue + Realtime instances that share the same auth
// storage; they race the auth token, which can stop Realtime from delivering
// postgres_changes (the board/sheet then look frozen until a manual refresh).
// One shared client — with the board and sidebar subscribing as separate
// channels on it — avoids that. Persists the session to cookies so the server
// and middleware can read it.
//
// Which project it talks to is `instancePublicConfig()`'s business: the pair
// the server put in the page at request time where there is one (a self-hosted
// image), the build's pair otherwise (the hosted app, the dev server, the
// desktop's substituted globals).
let client: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
  if (client) return client;
  const { supabaseUrl, supabasePublishableKey } = instancePublicConfig();
  client = createBrowserClient(supabaseUrl, supabasePublishableKey);
  return client;
}

export {
  findInstancePublicConfig,
  instancePublicConfig,
  type InstancePublicConfig,
} from "./instance-config";
