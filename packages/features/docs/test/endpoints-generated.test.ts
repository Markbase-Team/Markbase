import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOC_ENDPOINTS } from "@markbase/protocol/docs/endpoints";

// An endpoint is written once, beside its handler. The plain description the
// CLI, the MCP server and the skill read is a generated copy of those
// definitions, and it is committed — so this is what keeps the copy honest:
// what is on disk is exactly what the definitions generate.

const { definedEndpoints, endpointRoute } = await import("../src/handlers");
const { endpointsModule } = await import("../src/handlers/describe");

const generated = join(dirname(fileURLToPath(import.meta.url)), "../../../core/protocol/src/docs/endpoints.generated.ts");

describe("the generated endpoint descriptions", () => {
  it("are what the definitions generate", () => {
    expect(
      readFileSync(generated, "utf8"),
      "endpoints.generated.ts is stale — run: npx tsx packages/features/docs/scripts/gen-endpoints.ts"
    ).toBe(endpointsModule());
  });

  it("describe every defined endpoint, and nothing else", () => {
    expect(DOC_ENDPOINTS.map((e) => e.id)).toEqual(definedEndpoints().map((e) => e.def.id));
    expect(DOC_ENDPOINTS.length).toBeGreaterThan(30);
  });
});

describe("a defined endpoint", () => {
  it("checks the caller before its code runs", async () => {
    // No caller attached: the wrapper answers, and the handler never sees it.
    const res = await endpointRoute("docs_listVaults")(new Request("https://x.test/api/v1/vaults"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(401);
  });

  it("cannot be routed by an id nothing defines", () => {
    expect(() => endpointRoute("docs_noSuchThing")).toThrow(/No endpoint is defined/);
  });

  it("about a document names the document in its path", () => {
    for (const e of definedEndpoints()) {
      if (e.def.capability !== null) expect(e.def.path, e.def.id).toContain(":id");
    }
  });
});
