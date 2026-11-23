import { describe, expect, it } from "vitest";
import { toolRequest, type AgentTool } from "../src/endpoint-tools";
import {
  answerMcp,
  clientNameIn,
  clientNameOf,
  sessionIdFor,
  type JsonObject,
  type McpHost,
  type ToolAnswer,
} from "../src/mcp-http";

const READ: AgentTool = {
  name: "docs_readDoc",
  description: "Read a document (markdown + current version) — Always read before you edit",
  method: "GET",
  path: "/docs/:id",
  params: [{ name: "tab", type: "string" }],
  readOnly: true,
  destructive: false,
};
const EDIT: AgentTool = {
  name: "docs_editDoc",
  description: "Edit a passage (quote → insert) — the only way to change a doc",
  method: "POST",
  path: "/docs/:id/edits",
  params: [{ name: "quote", type: "string", required: true }],
  readOnly: false,
  destructive: false,
};

function host(answer: ToolAnswer = { ok: true, status: 200, body: '{"ok":true}' }) {
  const calls: { tool: string; args: JsonObject }[] = [];
  const h: McpHost = {
    name: "markbase-docs",
    version: "1.0.0",
    tools: () => [READ, EDIT],
    async call(tool, args) {
      calls.push({ tool: tool.name, args });
      return answer;
    },
  };
  return { h, calls };
}

describe("toolRequest", () => {
  it("fills the path and puts the rest of a read in the query", () => {
    expect(toolRequest(READ, { id: "a b", tab: "notes" })).toEqual({ method: "GET", path: "/docs/a%20b?tab=notes" });
  });

  it("puts the rest of a write in the JSON body", () => {
    expect(toolRequest(EDIT, { id: "d1", quote: "x" })).toEqual({
      method: "POST",
      path: "/docs/d1/edits",
      body: '{"quote":"x"}',
    });
  });

  it("names a missing path parameter", () => {
    expect(() => toolRequest(READ, {})).toThrow("Missing path param: id");
  });
});

describe("answerMcp", () => {
  it("answers initialize with the version the client asked for, when it knows it", async () => {
    const { h } = host();
    const a = await answerMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, h);
    expect(a).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "markbase-docs" } } });
  });

  it("offers its newest version to a client asking for one it does not know", async () => {
    const { h } = host();
    const a = await answerMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }, h);
    expect(a).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("lists the tools with their input schema", async () => {
    const { h } = host();
    const a = await answerMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, h);
    expect(a).toMatchObject({
      result: {
        tools: [
          {
            name: "docs_readDoc",
            title: "Read a document",
            inputSchema: { type: "object", required: ["id"] },
            annotations: { title: "Read a document", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
          },
          {
            name: "docs_editDoc",
            title: "Edit a passage",
            inputSchema: { required: ["id", "quote"] },
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
      },
    });
  });

  it("runs a tool and returns the API's answer as text", async () => {
    const { h, calls } = host();
    const a = await answerMcp(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "docs_readDoc", arguments: { id: "d1" } } },
      h
    );
    expect(calls).toEqual([{ tool: "docs_readDoc", args: { id: "d1" } }]);
    expect(a).toMatchObject({ result: { isError: false, content: [{ type: "text", text: '{\n  "ok": true\n}' }] } });
  });

  it("reports an API refusal as a tool error, with its status", async () => {
    const { h } = host({ ok: false, status: 403, body: '{"error":"no"}' });
    const a = await answerMcp(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "docs_readDoc", arguments: { id: "d1" } } },
      h
    );
    expect(a).toMatchObject({ result: { isError: true, content: [{ text: expect.stringContaining("HTTP 403") }] } });
  });

  it("does not run a tool it does not offer", async () => {
    const { h, calls } = host();
    const a = await answerMcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "docs_dropEverything" } }, h);
    expect(calls).toEqual([]);
    expect(a).toMatchObject({ result: { isError: true } });
  });

  it("has no answer for a notification", async () => {
    const { h } = host();
    expect(await answerMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, h)).toBeNull();
  });

  it("refuses a method it does not have, and a message that is not a request", async () => {
    const { h } = host();
    expect(await answerMcp({ jsonrpc: "2.0", id: 6, method: "resources/list" }, h)).toMatchObject({ error: { code: -32601 } });
    expect(await answerMcp("hello", h)).toMatchObject({ error: { code: -32600 } });
  });
});

describe("the client's name in the session id", () => {
  it("is read from initialize and survives the round trip", () => {
    const name = clientNameIn({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-ai" } } });
    expect(name).toBe("claude-ai");
    expect(clientNameOf(sessionIdFor("Clüde Desktop"))).toBe("Clüde Desktop");
  });

  it("is null for an id this server did not issue", () => {
    expect(clientNameOf(null)).toBeNull();
    expect(clientNameOf("abc")).toBeNull();
    expect(clientNameOf("mb1.!!!")).toBeNull();
    expect(clientNameOf(sessionIdFor("a\nb"))).toBeNull();
  });
});

describe("what the host is told of", () => {
  async function eventsFor(messages: JsonObject[]): Promise<string[]> {
    const events: string[] = [];
    const { h } = host();
    h.onEvent = (event, asked) => events.push(asked ? `${event}:${asked}` : event);
    for (const m of messages) await answerMcp(m, h);
    return events;
  }

  it("hears the hello, the tool listing, and a tool or method that is not there", async () => {
    expect(
      await eventsFor([
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "docs_dropEverything" } },
        { jsonrpc: "2.0", id: 4, method: "resources/list" },
      ])
    ).toEqual(["initialize", "tools_list", "unknown_tool:docs_dropEverything", "unknown_method:resources/list"]);
  });

  it("hears nothing for a tool call that reaches a tool, a ping or a notification", async () => {
    expect(
      await eventsFor([
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "docs_readDoc", arguments: { id: "d1" } } },
        { jsonrpc: "2.0", id: 2, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ])
    ).toEqual([]);
  });
});
