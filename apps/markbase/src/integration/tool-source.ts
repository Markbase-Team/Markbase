import { agentTools, parseAgentTools, type AgentTool } from "@markbase/shared/docs/agent-tools";

// Where the MCP server's tools come from. Its own file so it can be tested
// without starting a server.

/** How long a fetched tool list is used before the server is asked again. */
const TOOLS_FRESH_MS = 5 * 60_000;

/**
 * The tools to offer: the server's own list, so a tool added or withdrawn there
 * reaches this agent without a new release of the CLI. Falls back to the list
 * this build shipped with when the server cannot be reached or does not have
 * the endpoint yet, and asks again next time.
 */
export function toolSource(
  fetchTools: () => Promise<string | null>,
  now: () => number = Date.now
): () => Promise<AgentTool[]> {
  let held: { tools: AgentTool[]; at: number } | null = null;
  // A list and a call arriving together share one ask.
  let asking: Promise<AgentTool[]> | null = null;
  const ask = async (): Promise<AgentTool[]> => {
    let body: string | null = null;
    try {
      body = await fetchTools();
    } catch {
      body = null;
    }
    const served = body === null ? null : parseAgentTools(body);
    if (served) {
      held = { tools: served, at: now() };
      return served;
    }
    return held?.tools ?? agentTools();
  };
  return () => {
    if (held && now() - held.at < TOOLS_FRESH_MS) return Promise.resolve(held.tools);
    asking ??= ask().finally(() => {
      asking = null;
    });
    return asking;
  };
}
