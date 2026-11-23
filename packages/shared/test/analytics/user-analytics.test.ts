import { describe, expect, it } from "vitest";
import {
  USER_ANALYTICS_DEFAULT_LIMIT,
  USER_ANALYTICS_MAX_LIMIT,
  actorOf,
  clampUserAnalyticsLimit,
  SYNC_REQUEST_HEADER,
  isSyncRequest,
  isUserAnalyticsAction,
  isUserAnalyticsChannel,
  isUserAnalyticsOutcome,
  outcomeOfStatus,
  userAnalyticsDetail,
} from "../../src/analytics/user-analytics";
import { MCP_PROTOCOL_EVENTS } from "../../src/mcp-http";
import type { Caller } from "../../src/auth";

// Who acted, and how many rows a reader may ask for.

const person: Caller = { via: "session", ownerId: "u1", email: "a@example.test" };
const agent: Caller = {
  via: "api_key",
  ownerId: "u1",
  key: { id: "k1", provider: "claude_code", capability: null },
};

describe("actorOf", () => {
  it("names a signed-in person as a person", () => {
    expect(actorOf(person)).toEqual({ kind: "person" });
  });

  it("names a key's holder as an agent, with the key and its tool", () => {
    expect(actorOf(agent)).toEqual({ kind: "agent", keyId: "k1", provider: "claude_code", client: null });
  });

  it("keeps the MCP client's name, trimmed and clipped", () => {
    expect(actorOf(agent, "  claude-ai  ")).toMatchObject({ client: "claude-ai" });
    expect(actorOf(agent, "   ")).toMatchObject({ client: null });
    const long = actorOf(agent, "x".repeat(200));
    expect(long.kind === "agent" && long.client?.length).toBe(80);
  });

  it("names the tool the request says it is, over the one the key was stamped with", () => {
    expect(actorOf(agent, "claude-ai")).toMatchObject({ provider: "claude_desktop", client: "claude-ai" });
    expect(actorOf(agent, "codex-cli")).toMatchObject({ provider: "codex" });
    expect(actorOf(agent, "some-other-client")).toMatchObject({ provider: "claude_code" });
  });

  it("ignores a client name for a person", () => {
    expect(actorOf(person, "claude-ai")).toEqual({ kind: "person" });
  });
});

describe("clampUserAnalyticsLimit", () => {
  it("falls back to the default for nothing or nonsense", () => {
    expect(clampUserAnalyticsLimit(undefined)).toBe(USER_ANALYTICS_DEFAULT_LIMIT);
    expect(clampUserAnalyticsLimit(null)).toBe(USER_ANALYTICS_DEFAULT_LIMIT);
    expect(clampUserAnalyticsLimit(Number.NaN)).toBe(USER_ANALYTICS_DEFAULT_LIMIT);
  });

  it("keeps a page size within bounds", () => {
    expect(clampUserAnalyticsLimit(0)).toBe(1);
    expect(clampUserAnalyticsLimit(-5)).toBe(1);
    expect(clampUserAnalyticsLimit(25.9)).toBe(25);
    expect(clampUserAnalyticsLimit(10_000)).toBe(USER_ANALYTICS_MAX_LIMIT);
  });
});

describe("isUserAnalyticsChannel", () => {
  it("knows the four doors and nothing else", () => {
    for (const c of ["mcp", "api", "hook", "app"]) expect(isUserAnalyticsChannel(c)).toBe(true);
    for (const c of ["web", "", null, undefined]) expect(isUserAnalyticsChannel(c)).toBe(false);
  });
});

describe("outcomeOfStatus", () => {
  it("reads a refusal as denied, other failures as error, the rest as success", () => {
    expect([200, 201, 204, 304].map(outcomeOfStatus)).toEqual(["success", "success", "success", "success"]);
    expect([401, 403].map(outcomeOfStatus)).toEqual(["denied", "denied"]);
    expect([400, 404, 409, 500, 503].map(outcomeOfStatus)).toEqual(["error", "error", "error", "error", "error"]);
  });

  it("knows the three outcomes and nothing else", () => {
    for (const o of ["success", "denied", "error"]) expect(isUserAnalyticsOutcome(o)).toBe(true);
    for (const o of ["ok", "", null, undefined]) expect(isUserAnalyticsOutcome(o)).toBe(false);
  });
});

describe("isUserAnalyticsAction", () => {
  it("accepts a registered endpoint id and the MCP and hook events", () => {
    for (const a of ["docs_readDoc", "docs_createDoc", "me_whoami", "mcp.initialize", "mcp.unknown_tool", "hook.read", "hook.write"]) {
      expect(isUserAnalyticsAction(a), a).toBe(true);
    }
  });

  // The onboarding funnel is read from these: a card was shown, a starter
  // was picked, the "where to begin" tool was called.
  it("accepts every MCP protocol event, and the tool a new connection begins with", () => {
    for (const event of MCP_PROTOCOL_EVENTS) expect(isUserAnalyticsAction(`mcp.${event}`), event).toBe(true);
    expect(isUserAnalyticsAction("docs_getStarted")).toBe(true);
  });

  it("keeps which card was shown and which starter was picked", () => {
    expect(userAnalyticsDetail("mcp.resources_read", "ui://markbase/doc")).toBe("ui://markbase/doc");
    expect(userAnalyticsDetail("mcp.prompts_get", "get_started")).toBe("get_started");
    expect(userAnalyticsDetail("mcp.prompts_list", "anything")).toBeNull();
  });

  it("refuses anything else", () => {
    for (const a of ["docs_readdoc", "readDoc", "mcp.launch", "", null, undefined]) {
      expect(isUserAnalyticsAction(a), String(a)).toBe(false);
    }
  });
});

describe("isSyncRequest", () => {
  it("knows a vault sync's request by its mark, and nothing else", () => {
    expect(isSyncRequest(new Headers({ [SYNC_REQUEST_HEADER]: "1" }))).toBe(true);
    expect(isSyncRequest(new Headers())).toBe(false);
    expect(isSyncRequest(new Headers({ [SYNC_REQUEST_HEADER]: "yes" }))).toBe(false);
  });

  it("is a header the gate does not strip", () => {
    expect(SYNC_REQUEST_HEADER.startsWith("x-markbase-")).toBe(false);
  });
});
