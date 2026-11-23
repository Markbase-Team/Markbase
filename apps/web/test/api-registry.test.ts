import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_ENDPOINTS,
  AGENT_ENDPOINTS,
  DOC_ENDPOINTS,
  type DocEndpoint,
} from "@markbase/shared/docs/endpoints";
import { agentTools } from "@markbase/shared/docs/agent-tools";

// Every action the backend serves is in the endpoint registry, and the registry
// says for each one whether an agent may call it — and if not, why.
//
// The MCP server's tools, the agent skill and `markbase api` are all generated
// from the registry, so they cannot drift from an endpoint that is IN it. What
// could drift is a route nobody registered: the website and the desktop app
// would use it and agents would never hear of it. This test is what makes that
// impossible: a route file under /api/v1 with no registry entry fails here, and
// so does a registry entry with no route, or one hidden from agents with no
// reason given.

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../src/app/api/v1");

/**
 * Routes this app serves that are deliberately not in the registry, by path
 * prefix, each with the reason. Adding a route under a new prefix means adding
 * it to the registry or naming it here — either way, on purpose.
 */
const NOT_REGISTERED: { [prefix: string]: string } = {
  "/": "The public discovery manifest: what an agent reads before it has a key.",
  "/events": "Product analytics the app reports about itself (a modal shown, a button pressed); not an API for agents, and never an MCP tool.",
  "/instance": "How a client finds and joins an instance before it has a key; nothing to do once it has one.",
  "/keys": "The sign-in handshake that confirms a freshly minted key arrived.",
  "/repos": "The ticket worker's repository list, part of the projects feature, which the desktop app does not show.",
  "/secrets": "The secret vault holds ciphertext for the CLI; reading or writing it is not something to hand an agent as a tool.",
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface Served {
  method: string;
  /** With every parameter spelled `:`, so `[id]` and `:id` compare equal. */
  path: string;
  file: string;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name === "route.ts" ? [p] : [];
  });
}

/** `/docs/[id]/tabs/[tabId]` and `/docs/:id/tabs/:tabId` both as `/docs/:/tabs/:`. */
function shape(path: string): string {
  return path.replace(/\[[^\]]+\]|:\w+/g, ":") || "/";
}

function served(): Served[] {
  return routeFiles(apiRoot).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const path = shape(file.slice(apiRoot.length, -"/route.ts".length));
    return METHODS.filter((m) =>
      new RegExp(`export\\s+(?:const|async\\s+function|function)\\s+${m}\\b`).test(source)
    ).map((method) => ({ method, path, file: file.slice(apiRoot.length + 1) }));
  });
}

const REGISTERED: readonly DocEndpoint[] = [...DOC_ENDPOINTS, ...ACCOUNT_ENDPOINTS];
const key = (method: string, path: string) => `${method} ${shape(path)}`;

function exempt(path: string): boolean {
  return Object.keys(NOT_REGISTERED).some((prefix) =>
    prefix === "/" ? path === "/" : path === prefix || path.startsWith(`${prefix}/`)
  );
}

describe("the API and the endpoint registry", () => {
  const routes = served();
  const registry = new Set(REGISTERED.map((e) => key(e.method, e.path)));
  const serving = new Set(routes.map((r) => key(r.method, r.path)));

  it("finds the routes to check", () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it.each(routes.filter((r) => !exempt(r.path)).map((r) => [r.method, r.path, r.file]))(
    "%s %s (%s) is in the registry",
    (method, path) => {
      expect(
        registry.has(key(method, path)),
        `${method} ${path} is served but not registered. Add it to DOC_ENDPOINTS or ACCOUNT_ENDPOINTS ` +
          "(packages/shared/src/docs/endpoints.ts): agents get it as a tool unless you mark it " +
          "humanOnly and say why."
      ).toBe(true);
    }
  );

  it.each(REGISTERED.map((e) => [e.id, e.method, e.path]))("%s (%s %s) has a route", (_id, method, path) => {
    expect(serving.has(key(method, path)), `${method} ${path} is registered but no route file exports it`).toBe(true);
  });

  it("every exemption still names a route that exists", () => {
    for (const prefix of Object.keys(NOT_REGISTERED)) {
      expect(routes.some((r) => (prefix === "/" ? r.path === "/" : r.path === prefix || r.path.startsWith(`${prefix}/`))), prefix).toBe(true);
    }
  });
});

describe("what agents are offered", () => {
  it("an endpoint is hidden from agents only with a reason, and never with one otherwise", () => {
    for (const e of REGISTERED) {
      if (e.humanOnly) expect(e.why?.trim().length ?? 0, `${e.id} is humanOnly with no \`why\``).toBeGreaterThan(20);
      else expect(e.why, `${e.id} has a \`why\` but is not humanOnly`).toBeUndefined();
    }
  });

  it("every other endpoint is a tool, and nothing else is", () => {
    const tools = agentTools().map((t) => t.name).sort();
    expect(tools).toEqual(REGISTERED.filter((e) => !e.humanOnly).map((e) => e.id).sort());
    expect(AGENT_ENDPOINTS.map((e) => e.id).sort()).toEqual(tools);
  });

  it("a tool that removes something says so", () => {
    for (const t of agentTools()) {
      if (t.method === "DELETE" && /^docs_delete/.test(t.name)) expect(t.destructive, t.name).toBe(true);
      if (t.method === "GET") expect([t.readOnly, t.destructive], t.name).toEqual([true, false]);
    }
  });
});
