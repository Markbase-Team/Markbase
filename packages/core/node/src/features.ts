import { isFeatureEnabled, type FeatureEnv, type FeatureId } from "@markbase/protocol";
import { hasClaudeCode } from "./api-keys";

// What a signed-in user's machines can actually do. Pure logic over the
// protocol's feature table plus what this owner has paired — no request, no
// cookie, no framework. The redirect that used to sit beside this stayed in the
// Next app, because sending someone to a page is the shell's job.

/** 403 body for an API that needs a local Claude Code the caller doesn't have. */
export const CLAUDE_CODE_REQUIRED =
  "Claude Code isn't installed on any of your machines, so no agent can run this. See /dashboard/quickstart.";

/** What the signed-in user's machines can do. See @markbase/protocol features.ts. */
export async function getFeatureEnv(ownerId: string): Promise<FeatureEnv> {
  return { claudeCode: await hasClaudeCode(ownerId) };
}

export async function featureEnabled(
  id: FeatureId,
  ownerId: string
): Promise<boolean> {
  return isFeatureEnabled(id, await getFeatureEnv(ownerId));
}
