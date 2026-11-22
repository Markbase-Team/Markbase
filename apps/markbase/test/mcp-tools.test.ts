import { describe, it, expect } from "vitest";
import { agentTools } from "@markbase/protocol/docs/agent-tools";
import { toolSource } from "../src/integration/tool-source";

// Where the MCP server's tools come from: the server it talks to, so they follow
// a deploy rather than a release of this CLI — and the list this build shipped
// with whenever the server has no answer.

const served = (names: string[]) =>
  JSON.stringify({
    tools: names.map((name) => ({ name, description: name, method: "GET", path: `/x/${name}`, params: [] })),
  });

describe("toolSource", () => {
  it("offers the server's tools, including ones this build never had", async () => {
    const tools = toolSource(async () => served(["docs_listDocs", "docs_brandNew"]));
    expect((await tools()).map((t) => t.name)).toEqual(["docs_listDocs", "docs_brandNew"]);
  });

  it("falls back to the built-in list when the server has no answer, and asks again", async () => {
    let calls = 0;
    const tools = toolSource(async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
      if (calls === 2) return "<html>404</html>";
      return served(["docs_fromServer"]);
    });
    expect(await tools()).toEqual(agentTools());
    expect(await tools()).toEqual(agentTools());
    expect((await tools()).map((t) => t.name)).toEqual(["docs_fromServer"]);
  });

  it("asks once while the list is fresh, then again, keeping the last good list through a failure", async () => {
    let now = 0;
    let calls = 0;
    const tools = toolSource(
      async () => {
        calls++;
        return calls === 2 ? null : served([`docs_v${calls}`]);
      },
      () => now
    );
    await tools();
    await tools();
    expect(calls).toBe(1);
    now = 6 * 60_000;
    expect((await tools()).map((t) => t.name)).toEqual(["docs_v1"]); // the failed refresh
    expect((await tools()).map((t) => t.name)).toEqual(["docs_v3"]);
  });
});
