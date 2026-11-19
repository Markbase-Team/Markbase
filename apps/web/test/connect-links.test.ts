import { describe, expect, it } from "vitest";
import { claudeCodeCommand, codexCommand, connectOptions, cursorInstallLink, vscodeInstallLink } from "../src/lib/connect-links";

const URL_ = "https://markbase.so/mcp";

describe("connect links", () => {
  it("builds Cursor's install link with the server config as base64", () => {
    const link = new URL(cursorInstallLink(URL_));
    expect(link.protocol).toBe("cursor:");
    expect(link.pathname).toBe("/mcp/install");
    expect(link.searchParams.get("name")).toBe("markbase-docs");
    expect(JSON.parse(atob(link.searchParams.get("config") ?? ""))).toEqual({ url: URL_ });
  });

  it("builds VS Code's install link with the server as JSON", () => {
    const link = vscodeInstallLink(URL_);
    expect(link.startsWith("vscode:mcp/install?")).toBe(true);
    expect(JSON.parse(decodeURIComponent(link.slice("vscode:mcp/install?".length)))).toEqual({
      name: "markbase-docs",
      type: "http",
      url: URL_,
    });
  });

  it("writes the commands for the CLIs", () => {
    expect(claudeCodeCommand(URL_)).toBe("claude mcp add --transport http markbase-docs https://markbase.so/mcp");
    expect(codexCommand(URL_)).toBe("codex mcp add markbase-docs --url https://markbase.so/mcp");
  });

  it("uses the instance's own address, and carries no key", () => {
    const options = connectOptions("https://docs.example.com/mcp");
    expect(options.map((o) => o.id)).toEqual(["claude", "claude-code", "codex", "cursor", "vscode"]);
    for (const o of options) {
      const said = decodeURIComponent(`${o.href ?? ""} ${o.copy ?? ""}`);
      expect(said).not.toMatch(/jsk_|Bearer/);
    }
    expect(options.find((o) => o.id === "claude")?.copy).toBe("https://docs.example.com/mcp");
    expect(options.find((o) => o.id === "codex")?.copy).toContain("https://docs.example.com/mcp");
  });
});
