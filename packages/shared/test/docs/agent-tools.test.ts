import { describe, it, expect } from "vitest";
import { agentTools, parseAgentTools, toolInputSchema } from "../../src/docs/agent-tools";

// The tool list as data: what the server answers at GET /agent/tools and what
// the MCP server turns into tools. Under test: that the list survives the trip
// (a client that never heard of an endpoint can still call it), and that an
// answer that is not a tool list is refused whole rather than half-used.

describe("agentTools", () => {
  it("offers what a person can do in the app, and not the plumbing", () => {
    const names = agentTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "docs_listDocs",
        "docs_searchDocs",
        "docs_editDoc",
        "docs_publish",
        "docs_listVaults",
        "docs_createVault",
        "docs_listAssets",
        "me_whoami",
      ])
    );
    for (const hidden of ["docs_readCrdt", "docs_replaceContent", "docs_uploadAsset", "docs_addTab", "agent_listTools", "worker_claim"]) {
      expect(names).not.toContain(hidden);
    }
  });

  // Analytics is an API call, so it is a tool: the same answer the Analytics
  // panel shows, for the document the agent names.
  it("offers a document's analytics as a read-only tool taking the document's id", () => {
    const tool = agentTools().find((t) => t.name === "docs_analytics");
    expect(tool).toMatchObject({ method: "GET", path: "/docs/:id/analytics", readOnly: true, destructive: false });
    expect(tool?.description).toContain("which agents read");
    expect(tool && toolInputSchema(tool)).toEqual({
      type: "object",
      properties: { id: { type: "string", description: "path parameter" } },
      required: ["id"],
    });
  });

  it("marks what only reads and what cannot be undone", () => {
    const by = new Map(agentTools().map((t) => [t.name, t]));
    expect([by.get("docs_readDoc")?.readOnly, by.get("docs_readDoc")?.destructive]).toEqual([true, false]);
    expect(by.get("docs_deleteVault")?.destructive).toBe(true);
    expect(by.get("docs_deleteDoc")?.destructive).toBe(true);
    expect(by.get("docs_editDoc")?.destructive).toBe(false);
  });

  it("builds an input schema from path and declared parameters", () => {
    const publish = agentTools().find((t) => t.name === "docs_publish");
    expect(publish && toolInputSchema(publish)).toEqual({
      type: "object",
      properties: {
        id: { type: "string", description: "path parameter" },
        version: { type: "number", description: expect.stringContaining("version index") },
      },
      required: ["id"],
    });
  });
});

describe("parseAgentTools", () => {
  it("reads back exactly what the server sent", () => {
    const sent = agentTools();
    expect(parseAgentTools(JSON.stringify({ tools: sent }))).toEqual(sent);
  });

  it("accepts a tool this build has never heard of", () => {
    const body = JSON.stringify({
      tools: [{ name: "docs_newThing", description: "New", method: "POST", path: "/docs/:id/new", params: [{ name: "x", type: "string" }] }],
    });
    expect(parseAgentTools(body)).toEqual([
      { name: "docs_newThing", description: "New", method: "POST", path: "/docs/:id/new", params: [{ name: "x", type: "string" }], readOnly: false, destructive: false },
    ]);
  });

  it("refuses an answer that is not a tool list, whole", () => {
    expect(parseAgentTools("<html>502</html>")).toBeNull();
    expect(parseAgentTools(JSON.stringify({ error: "Not found" }))).toBeNull();
    expect(parseAgentTools(JSON.stringify({ tools: [] }))).toBeNull();
    const oneBad = [...agentTools(), { name: "bad tool name", description: "x", method: "GET", path: "/x" }];
    expect(parseAgentTools(JSON.stringify({ tools: oneBad }))).toBeNull();
    expect(parseAgentTools(JSON.stringify({ tools: [{ name: "x", description: "x", method: "TRACE", path: "/x" }] }))).toBeNull();
  });
});
