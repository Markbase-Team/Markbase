import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLACEHOLDER_API_KEY } from "@markbase/node";

// Which key the CLI and the MCP server use. An agent's config can name one in
// MARKBASE_API_KEY; otherwise it is the one `markbase login` saved. The case
// that broke people: an older installer wrote a placeholder into the agent's
// config, where it outranked the real key saved later and every call got 401.

let home: string;

async function config(): Promise<typeof import("../src/config")> {
  vi.resetModules(); // the config path is read when the module loads
  return import("../src/config");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "markbase-config-"));
  vi.stubEnv("MARKBASE_HOME", home);
  vi.stubEnv("MARKBASE_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const save = (apiKey: string): void => writeFileSync(join(home, "config.json"), JSON.stringify({ apiKey }));

describe("which API key is used", () => {
  it("is the saved key when the environment names none", async () => {
    save("jsk_saved");
    const { loadConfig, savedApiKey, environmentApiKey } = await config();
    expect(loadConfig().apiKey).toBe("jsk_saved");
    expect(savedApiKey()).toBe("jsk_saved");
    expect(environmentApiKey()).toBe("");
  });

  it("is the environment's key when it names a real one", async () => {
    save("jsk_saved");
    vi.stubEnv("MARKBASE_API_KEY", "jsk_from_env");
    const { loadConfig, savedApiKey } = await config();
    expect(loadConfig().apiKey).toBe("jsk_from_env");
    expect(savedApiKey()).toBe("jsk_saved");
  });

  it("ignores the placeholder an older installer left in an agent's config", async () => {
    save("jsk_saved");
    vi.stubEnv("MARKBASE_API_KEY", PLACEHOLDER_API_KEY);
    const { loadConfig } = await config();
    expect(loadConfig().apiKey).toBe("jsk_saved");
  });

  it("is empty, not the placeholder, when nobody has signed in", async () => {
    vi.stubEnv("MARKBASE_API_KEY", PLACEHOLDER_API_KEY);
    const { loadConfig } = await config();
    expect(loadConfig().apiKey).toBe("");
  });
});
