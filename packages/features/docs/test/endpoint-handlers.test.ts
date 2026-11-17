import { describe, it, expect } from "vitest";

// An endpoint is its registry entry plus the code that answers it. The route
// files are generated from the two, so what matters here is that the two
// lists name exactly the same endpoints.

const { DOC_ENDPOINTS } = await import("../src/logic/endpoints");
const { ENDPOINT_HANDLERS, endpointRoute } = await import("../src/handlers/endpoint-handlers");

describe("endpoint handlers", () => {
  it("has a handler for every documents endpoint, and none for anything else", () => {
    expect(Object.keys(ENDPOINT_HANDLERS).sort()).toEqual(DOC_ENDPOINTS.map((e) => e.id).sort());
  });

  it("refuses to build a route for an endpoint with no handler", () => {
    expect(() => endpointRoute("docs_noSuchThing")).toThrow(/No handler/);
  });

  it("hands the path's parameters to the handler", async () => {
    const seen: string[] = [];
    ENDPOINT_HANDLERS.test_echo = async (_req, p) => {
      seen.push(`${p.id}/${p.cid}`);
      return new Response("ok");
    };
    const route = endpointRoute("test_echo");
    const res = await route(new Request("https://x.test/"), { params: Promise.resolve({ id: "d1", cid: "c9" }) });
    delete ENDPOINT_HANDLERS.test_echo;
    expect([await res.text(), seen]).toEqual(["ok", ["d1/c9"]]);
  });
});
