import { describe, it, expect } from "vitest";
import { AGENT_ENDPOINTS } from "@markbase/docs/endpoints";
import { mcpTools } from "../src/integration/mcp-tools";

// The MCP server's tools are the endpoint registry, not a list kept here: an
// endpoint the API serves to agents is a tool, by the same id.
describe("mcp tools", () => {
  it("offers one tool per agent endpoint", () => {
    expect(mcpTools().map((t) => t.name)).toEqual(AGENT_ENDPOINTS.map((e) => e.id));
  });

  it("offers a document's analytics, taking the document's id", () => {
    const tool = mcpTools().find((t) => t.name === "docs_analytics");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("which agents read");
    expect(tool?.inputSchema).toEqual({
      type: "object",
      properties: { id: { type: "string", description: "path parameter" } },
      required: ["id"],
    });
  });
});
