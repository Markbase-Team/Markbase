import { describe, expect, it } from "vitest";
import type { AgentTool } from "../src/endpoint-tools";
import {
  MCP_APP_MIME,
  answerMcp,
  type JsonObject,
  type McpApp,
  type McpHost,
  type McpPrompt,
  type McpProtocolEvent,
} from "../src/mcp-http";

// What the server says beyond its tools: what it is for (instructions), the
// cards that show a tool's answer in the conversation (MCP Apps: resources
// linked from tools), and the starters a person can pick (prompts). A host
// that offers none of them is the server it was before it had any.

const READ: AgentTool = {
  name: "docs_readDoc",
  description: "Read a document",
  method: "GET",
  path: "/docs/:id",
  params: [],
  readOnly: true,
  destructive: false,
};
const LIST: AgentTool = { ...READ, name: "docs_listDocs", path: "/docs" };

const CARD: McpApp = {
  uri: "ui://markbase/doc",
  name: "Markbase document",
  description: "A document, as it reads.",
  tools: ["docs_readDoc"],
  html: "<!doctype html><p>card</p>",
};
const STARTER: McpPrompt = {
  name: "get_started",
  title: "Get started with Markbase",
  description: "See your vault.",
  text: "I just connected Markbase.",
};

function host(extra: Partial<McpHost> = {}) {
  const heard: { event: McpProtocolEvent; asked?: string }[] = [];
  const h: McpHost = {
    name: "markbase-docs",
    version: "1.0.0",
    tools: () => [READ, LIST],
    call: async () => ({ ok: true, status: 200, body: "{}" }),
    onEvent: (event, asked) => heard.push(asked === undefined ? { event } : { event, asked }),
    ...extra,
  };
  return { h, heard };
}

const ask = (h: McpHost, method: string, params: JsonObject = {}) =>
  answerMcp({ jsonrpc: "2.0", id: 1, method, params }, h);

describe("a server with cards, starters and instructions", () => {
  const full = () => host({ instructions: "Markbase is…", apps: [CARD], prompts: [STARTER] });

  it("says so when a client connects", async () => {
    const answer = await ask(full().h, "initialize", { protocolVersion: "2025-06-18" });
    expect(answer?.result).toMatchObject({
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions: "Markbase is…",
    });
  });

  it("links a tool to its card, and leaves the other tools as they were", async () => {
    const answer = await ask(full().h, "tools/list");
    const tools = (answer?.result as { tools: JsonObject[] }).tools;
    expect(tools[0]._meta).toEqual({ ui: { resourceUri: "ui://markbase/doc" }, "ui/resourceUri": "ui://markbase/doc" });
    expect("_meta" in tools[1]).toBe(false);
  });

  it("lists its cards as resources, and has no templates", async () => {
    const { h } = full();
    expect((await ask(h, "resources/list"))?.result).toEqual({
      resources: [{ uri: CARD.uri, name: CARD.name, description: CARD.description, mimeType: MCP_APP_MIME }],
    });
    expect((await ask(h, "resources/templates/list"))?.result).toEqual({ resourceTemplates: [] });
  });

  it("serves a card's page as an MCP App, asking the host for no domains", async () => {
    const { h, heard } = full();
    const answer = await ask(h, "resources/read", { uri: CARD.uri });
    expect(answer?.result).toEqual({
      contents: [{ uri: CARD.uri, mimeType: "text/html;profile=mcp-app", text: CARD.html, _meta: { ui: { prefersBorder: true } } }],
    });
    // A card read is a card about to be shown: the record says which.
    expect(heard).toEqual([{ event: "resources_read", asked: CARD.uri }]);
  });

  it("refuses a resource it does not have", async () => {
    const answer = await ask(full().h, "resources/read", { uri: "ui://markbase/other" });
    expect(answer?.error).toMatchObject({ code: -32002 });
  });

  it("lists its starters and hands one over as the person's message", async () => {
    const { h, heard } = full();
    expect((await ask(h, "prompts/list"))?.result).toEqual({
      prompts: [{ name: "get_started", title: STARTER.title, description: STARTER.description }],
    });
    expect((await ask(h, "prompts/get", { name: "get_started" }))?.result).toEqual({
      description: STARTER.description,
      messages: [{ role: "user", content: { type: "text", text: STARTER.text } }],
    });
    expect(heard).toEqual([{ event: "prompts_list" }, { event: "prompts_get", asked: "get_started" }]);
  });

  it("refuses a starter it does not have", async () => {
    expect((await ask(full().h, "prompts/get", { name: "nope" }))?.error).toMatchObject({ code: -32602 });
  });
});

describe("a server with none of them", () => {
  it("connects exactly as before", async () => {
    const answer = await ask(host().h, "initialize", { protocolVersion: "2025-06-18" });
    expect(answer?.result).toEqual({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "markbase-docs", version: "1.0.0" },
    });
  });

  it("adds nothing to its tools", async () => {
    const tools = ((await ask(host().h, "tools/list"))?.result as { tools: JsonObject[] }).tools;
    expect(tools.some((t) => "_meta" in t)).toBe(false);
  });

  it("does not have the resource or prompt methods, and hears each as unknown", async () => {
    const { h, heard } = host();
    for (const method of ["resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get"]) {
      expect((await ask(h, method))?.error).toMatchObject({ code: -32601 });
    }
    expect(heard.map((e) => e.event)).toEqual(Array(5).fill("unknown_method"));
  });
});
