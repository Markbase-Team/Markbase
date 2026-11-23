import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import type { AgentTool } from "@markbase/shared/docs/agent-tools";
import type { JsonObject, McpHost, ToolAnswer } from "@markbase/shared/mcp-http";

// login.ts reaches the skill installer, which bundles SKILL.md through tsup's
// loader; vitest has no loader for it, and nothing here signs in anyway.
vi.mock("../src/login", () => ({
  ensureAuthenticated: async () => true,
  agentBrowserLogin: async () => "",
}));

import { serveMcpLines } from "../src/integration/mcp";

// `markbase mcp` over its two streams: a message per line in, an answer per
// line out. The server behind it is the hosted one's (@markbase/shared/mcp-http);
// what is tested here is the door.

const READ: AgentTool = {
  name: "docs_readDoc",
  description: "Read a document",
  method: "GET",
  path: "/docs/:id",
  params: [],
  readOnly: true,
  destructive: false,
};

function host(call: McpHost["call"] = async () => ({ ok: true, status: 200, body: '{"ok":true}' })): McpHost {
  return { name: "markbase-docs", version: "9.9.9", tools: async () => [READ], call };
}

/** Send lines, end the input, and collect what was written back. */
async function talk(h: McpHost, lines: string[], seen?: Parameters<typeof serveMcpLines>[2]): Promise<JsonObject[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const written: Buffer[] = [];
  output.on("data", (chunk: Buffer) => written.push(chunk));
  const served = serveMcpLines(h, { input, output }, seen);
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  await served;
  return Buffer.concat(written)
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonObject);
}

const INIT = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"claude-code","version":"2"}}}';

describe("serveMcpLines", () => {
  it("answers the handshake, a tool listing and a tool call, one line each", async () => {
    const answers = await talk(host(), [
      INIT,
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"docs_readDoc","arguments":{"id":"d1"}}}',
    ]);
    expect(answers.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(answers[0]).toMatchObject({
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "markbase-docs", version: "9.9.9" } },
    });
    expect(answers[1]).toMatchObject({ result: { tools: [{ name: "docs_readDoc" }] } });
    expect(answers[2]).toMatchObject({ result: { isError: false } });
  });

  it("shows each message to the caller, so the client's name can be kept", async () => {
    const names: string[] = [];
    await talk(host(), [INIT], (message) => {
      if (typeof message === "object" && message !== null && !Array.isArray(message)) {
        const params = message.params;
        if (typeof params === "object" && params !== null && !Array.isArray(params)) {
          const info = params.clientInfo;
          if (typeof info === "object" && info !== null && !Array.isArray(info) && typeof info.name === "string") names.push(info.name);
        }
      }
    });
    expect(names).toEqual(["claude-code"]);
  });

  it("does not hold a ping behind a slow tool call", async () => {
    let release: (answer: ToolAnswer) => void = () => undefined;
    const slow = new Promise<ToolAnswer>((resolve) => {
      release = resolve;
    });
    const input = new PassThrough();
    const output = new PassThrough();
    const ids: number[] = [];
    output.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n").filter(Boolean)) {
        const id = (JSON.parse(line) as JsonObject).id;
        if (typeof id === "number") ids.push(id);
        // The ping came back while the tool call was still running: let it finish.
        if (id === 2) release({ ok: true, status: 200, body: "{}" });
      }
    });
    const served = serveMcpLines(host(() => slow), { input, output });
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"docs_readDoc","arguments":{"id":"d1"}}}\n');
    input.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    input.end();
    await served;
    expect(ids).toEqual([2, 1]);
  });

  it("answers a line that is not JSON, and keeps going", async () => {
    const answers = await talk(host(), ["{nope", '{"jsonrpc":"2.0","id":7,"method":"ping"}']);
    expect(answers).toHaveLength(2);
    expect(answers.find((a) => a.id === null)).toMatchObject({ error: { code: -32700 } });
    expect(answers.find((a) => a.id === 7)).toMatchObject({ result: {} });
  });

  it("writes nothing for input that asks nothing", async () => {
    expect(await talk(host(), ["", '{"jsonrpc":"2.0","method":"notifications/initialized"}'])).toEqual([]);
  });
});
