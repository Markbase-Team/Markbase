import { agentJson, preflight } from "@/lib/agent-auth";
import { serverInstanceConfig } from "@/lib/instance-info";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

/** What a client learns about an instance before it has a key. */
export interface InstanceInfo {
  name: string;
  /** Where this instance is reached: its own idea of its public URL. */
  app_url: string;
  /** The Supabase project behind it — the PUBLIC half, same as every browser gets. */
  supabase_url: string;
  supabase_publishable_key: string;
}

// GET /api/v1/instance — public: which Supabase project this instance runs on.
//
// A self-hosted Markbase is one URL, the way a Grafana is: a team member points
// the CLI or the desktop app at it and nothing else. The CLI needs nothing more
// (everything it does goes through this API), but the desktop app's windows
// join a document's live channel on the Supabase project directly, and used to
// know only the hosted one, baked into the build. This is where they ask instead.
//
// Nothing here is secret. The URL and the publishable key are in every page this
// server renders (the root layout puts them there, from the same read), and the
// project's row-level security is what the key is allowed to see. The secret
// key never leaves the server.
export function GET(req: Request) {
  const project = serverInstanceConfig();
  if (!project) {
    return agentJson({ error: "This instance has no Supabase project configured" }, 503);
  }
  const info: InstanceInfo = {
    name: "Markbase",
    app_url: (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/+$/, ""),
    supabase_url: project.supabaseUrl,
    supabase_publishable_key: project.supabasePublishableKey,
  };
  return agentJson(info);
}
