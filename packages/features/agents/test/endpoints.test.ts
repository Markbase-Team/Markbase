import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generatedDrift } from "@markbase/server/generated-files";
import { toolsFrom } from "@markbase/shared/endpoint-tools";

// The agents feature's endpoints are written once, in src/handlers, and its
// route files are generated from them. Held here: the committed route files
// are exactly what the definitions generate, every endpoint is hidden from
// agents for a stated reason, and none answers a request with no caller.

const { definedEndpoints, agentsRoute } = await import("../src/handlers");
const { agentsRouteFiles } = await import("../src/handlers/routes");

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../src/app/api/v1");

describe("agents endpoints", () => {
  it("are the three the Agents page uses", () => {
    expect(definedEndpoints().map((e) => `${e.def.method} ${e.def.path} ${e.def.id}`)).toEqual([
      "GET /agent-sessions agents_listSessions",
      "POST /agent-sessions agents_createSession",
      "PATCH /agent-sessions/:id agents_updateSession",
    ]);
  });

  it("are all hidden from agents, each saying why", () => {
    for (const e of definedEndpoints()) {
      expect([e.def.humanOnly, (e.def.why ?? "").length > 20], e.def.id).toEqual([true, true]);
    }
    expect(toolsFrom(definedEndpoints().map((e) => e.def))).toEqual([]);
  });

  it("refuse a request the gate attached no caller to", async () => {
    for (const e of definedEndpoints()) {
      const res = await agentsRoute(e.def.id)(
        new Request("https://x.test/api/v1/agent-sessions", { method: e.def.method }),
        { params: Promise.resolve({ id: "s1" }) }
      );
      expect(res.status, e.def.id).toBe(401);
    }
  });

  it("have route files that are exactly what the definitions generate", () => {
    expect(
      generatedDrift(apiRoot, agentsRouteFiles(), { dirs: ["."], name: "route.ts" }),
      "run: npm run gen:endpoints"
    ).toEqual({ changed: [], stale: [] });
  });
});
