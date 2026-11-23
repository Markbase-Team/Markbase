import type { Provider } from "@markbase/shared/agent-sessions";
import type { Caller } from "@markbase/shared/auth";
import type { AgentReadTally } from "@markbase/shared/docs";
import { HOOK_EVENT_ACTIONS, type HookEvent } from "@markbase/shared/analytics/hook-events";
import { recordUserAnalytics, summarizeDocReads } from "@markbase/server/analytics/user-analytics-store";
import { ownerDisplayName } from "./owner-name";

// Which agents read a document, from the one place a read is recorded:
// user_analytics_events.
//
// A read gets there two ways. An agent reading through the API is recorded as
// it reads, like every other call it makes. An agent reading the FILE, in a
// vault on someone's machine, is seen only by its hook; the sync daemon there
// reports what the hooks saw, one event each (POST /hook-events,
// `recordHookEvent`).
//
// What the Analytics panel shows is the tally worked out from those rows
// (`recordedDocReads`), in the shape the document's own tally has, so the two
// can be added together (analytics.ts says when the document's is still used).

/** The tool a hook's name stands for. A hook says "claude" and means Claude Code. */
export function hookProvider(agent: string): Provider {
  switch (agent.toLowerCase()) {
    case "claude":
    case "claude_code":
      return "claude_code";
    case "claude_desktop":
      return "claude_desktop";
    case "codex":
      return "codex";
    case "cursor":
      return "cursor";
    default:
      return "unknown";
  }
}

/** The name a tally gives a tool — the names agents' hooks use. */
function tallyAgent(provider: Provider, hookName: string | null): string {
  if (hookName) return hookName;
  return provider === "claude_code" ? "claude" : provider;
}

/**
 * Record one thing an agent's hook saw, under the account of the daemon that
 * reported it. Whether that account may report it for this document is the
 * handler's to have checked. True when it was written.
 */
export async function recordHookEvent(caller: Caller, event: HookEvent): Promise<boolean> {
  return recordUserAnalytics({
    ownerId: caller.ownerId,
    // The daemon's key, not the agent's: an agent working on a file has none.
    actor: {
      kind: "agent",
      keyId: caller.via === "api_key" ? caller.key.id : null,
      provider: hookProvider(event.agent),
      client: event.agent,
    },
    channel: "hook",
    action: HOOK_EVENT_ACTIONS[event.kind],
    docId: event.docId,
    outcome: "success",
    at: new Date(event.at).toISOString(),
  });
}

/**
 * The document's read tally, from the record. Empty when the record cannot be
 * read: the panel then shows what the document itself holds, which is better
 * than no panel.
 */
export async function recordedDocReads(docId: string): Promise<AgentReadTally[]> {
  try {
    const summaries = await summarizeDocReads(docId);
    return await Promise.all(
      summaries.map(async (summary) => ({
        agent: tallyAgent(summary.provider, summary.client),
        owner: await ownerDisplayName(summary.ownerId),
        count: summary.count,
        lastAt: Date.parse(summary.lastAt),
      }))
    );
  } catch (err) {
    console.warn(`[doc-reads] ${docId}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
