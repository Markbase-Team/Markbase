import { redirect } from "next/navigation";
import type { FeatureId } from "@markbase/protocol";
import { featureEnabled } from "@markbase/node/features";
import { getCurrentUser } from "@/lib/supabase/server";

// Only the part that needs Next. Deciding WHETHER a feature is available is
// pure logic and lives in @markbase/node/features, where a package can reach
// it; sending someone to a page is the shell's job and stays here.

export { CLAUDE_CODE_REQUIRED, getFeatureEnv, featureEnabled } from "@markbase/node/features";

/**
 * Gate a server component on a Claude-Code-only feature. Sends the user to the
 * quickstart page — which explains how to unlock it — rather than 404ing or
 * rendering a board that can never run anything.
 */
export async function requireFeature(id: FeatureId): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await featureEnabled(id, user.id))) {
    redirect(`/dashboard/quickstart?feature=${id}`);
  }
}
