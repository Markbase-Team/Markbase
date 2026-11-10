import type { InstancePublicConfig } from "@markbase/protocol/instance-config";

// The Supabase project THIS server runs on — the public half, read from the
// server's environment when asked, not when built.
//
// On the hosted app the two names are set at build time as well, and Next
// substitutes them, so the answer is the build's project; that is the same
// project, because there the build is the deployment. A self-hosted image is
// built with neither (Dockerfile), the reads are left alone, and the container's
// environment answers — which is what lets one image serve any instance. Every
// place the server tells a client which project it runs on reads from here:
// the root layout, which puts it in each page, and GET /api/v1/instance.
export function serverInstanceConfig(): InstancePublicConfig | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabasePublishableKey) return null;
  return { supabaseUrl, supabasePublishableKey };
}
