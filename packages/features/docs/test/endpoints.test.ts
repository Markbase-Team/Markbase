import { describe, it, expect } from "vitest";
import { DOC_ENDPOINTS, docEndpoint } from "../src/logic/endpoints";
import { renderEndpointsDoc } from "../src/logic/skill-doc";

describe("endpoint registry", () => {
  it("has unique ids and method+path pairs", () => {
    const ids = DOC_ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = DOC_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("docEndpoint resolves a known id and throws on an unknown one", () => {
    expect(docEndpoint("docs_editDoc").capability).toBe("editor");
    expect(docEndpoint("docs_readDoc").capability).toBe("viewer");
    expect(() => docEndpoint("nope")).toThrow();
  });

  // The ids became the namespaced form in one step, with no aliases. A caller
  // still passing the old bare id must fail loudly rather than resolve to
  // undefined and be read as "no capability required".
  it("rejects the pre-namespace bare ids", () => {
    for (const bare of ["readDoc", "editDoc", "listDocs", "deleteTab"]) {
      expect(() => docEndpoint(bare)).toThrow();
    }
  });

  /**
   * An id is not only a registry key: `apps/markbase`'s MCP server publishes it
   * verbatim as the tool name (integration/mcp.ts). The Anthropic Messages API
   * constrains a tool name to `^[a-zA-Z0-9_-]{1,128}$`, so a separator that
   * reads nicely here — a dot, or the `plugin:skill` colon — is rejected on the
   * wire. Underscore is the one separator that is legal in every consumer, which
   * is why the id and the tool name can be the same string at all.
   */
  it("every id is a legal Anthropic tool name", () => {
    for (const e of DOC_ENDPOINTS) {
      expect(e.id).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    }
  });

  // feature_operation: the feature is lowercase and the operation is camelCase,
  // so the FIRST underscore splits them unambiguously. Collisions between
  // independently-developed packages are the key-collision failure the registry
  // has to rule out once features other than docs export endpoints.
  it("every id is namespaced feature_operation, and the feature is docs", () => {
    for (const e of DOC_ENDPOINTS) {
      expect(e.id).toMatch(/^[a-z][a-z0-9]*_[a-zA-Z][a-zA-Z0-9]*$/);
      expect(e.id.split("_")[0]).toBe("docs");
    }
  });

  it("renders each documented endpoint with role, when, input/output", () => {
    const md = renderEndpointsDoc();
    expect(md).toContain("/docs/:id/edits");
    expect(md).toContain("role: **editor**");
    expect(md).toContain("- **When:**");
    // every skill-documented endpoint shows up in the how-to section
    for (const e of DOC_ENDPOINTS) {
      if (e.skill) expect(md).toContain(`### ${e.summary}`);
    }
  });
});

// The worker's endpoints share the registry (ids, methods, paths, scopes) but
// not the agent's view of it: a worker claiming jobs is plumbing, and the skill,
// the MCP server and `markbase api` must not offer it.
describe("worker endpoints", async () => {
  const { WORKER_ENDPOINTS, ALL_ENDPOINTS, AGENT_ENDPOINTS } = await import("../src/logic/endpoints");

  it("have unique ids and method+path pairs across the whole registry", () => {
    const ids = ALL_ENDPOINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const routes = ALL_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("are account-level, namespaced by the feature that serves them, and hidden from agents", () => {
    expect(WORKER_ENDPOINTS.length).toBeGreaterThan(10);
    for (const e of WORKER_ENDPOINTS) {
      expect(e.capability).toBeNull();
      expect(e.humanOnly).toBe(true);
      expect(e.id).toMatch(/^(worker|tickets|me|projects)_[a-zA-Z][a-zA-Z0-9]*$/);
      expect(e.path.startsWith(`/${e.id.split("_")[0]}`)).toBe(true);
      expect(AGENT_ENDPOINTS).not.toContain(e);
    }
  });

  it("read with GET and write with everything else", () => {
    for (const e of WORKER_ENDPOINTS) {
      expect(e.scope).toBe(e.method === "GET" ? "read" : "write");
    }
  });
});
