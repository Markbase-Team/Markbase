import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startClaudeCodeSession, type ClaudeCodeResult } from "../src/claude-code";

// A stand-in `claude`: prints one stream-json result line and exits. What the
// test cares about is WHICH binary ran, so it also records its own path.
function fakeClaude(): { bin: string; argvFile: string } {
  const dir = mkdtempSync(join(tmpdir(), "fake-claude-"));
  const bin = join(dir, "claude");
  const argvFile = join(dir, "argv");
  writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\n' "$0" > "${argvFile}"
printf '%s\\n' '{"type":"result","session_id":"s-1","result":"ran from the host binary","is_error":false}'
`
  );
  chmodSync(bin, 0o755);
  return { bin, argvFile };
}

describe("startClaudeCodeSession: which Claude runs", () => {
  it("runs the binary the host hands it, not whatever PATH says", async () => {
    const { bin, argvFile } = fakeClaude();
    const result = await new Promise<ClaudeCodeResult>((resolve) =>
      startClaudeCodeSession({ cwd: tmpdir(), prompt: "hi", claudeBin: bin, onComplete: resolve })
    );
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe("s-1");
    expect(result.summary).toBe("ran from the host binary");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(argvFile, "utf8").trim()).toBe(bin);
  });

  it("reports a binary that does not exist as a failed launch, not a hang", async () => {
    const result = await new Promise<ClaudeCodeResult>((resolve) =>
      startClaudeCodeSession({
        cwd: tmpdir(),
        prompt: "hi",
        claudeBin: "/nonexistent/claude",
        onComplete: resolve,
      })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ENOENT/);
  });
});
