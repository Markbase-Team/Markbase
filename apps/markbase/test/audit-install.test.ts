import { describe, it, expect } from "vitest";
import { withCursorHooks, withToolHooks } from "../src/audit-install";

// The installer merges into files people already keep settings and hooks in.
// These pin that it adds what is missing, keeps what is there, and adds
// nothing the second time.

const CLAUDE = [
  { event: "PreToolUse", matcher: "Edit|Write|MultiEdit", audit: "write-audit" as const },
  { event: "PostToolUse", matcher: "Read", audit: "read-audit" as const },
  { event: "PostToolUse", matcher: "Edit|Write|MultiEdit", audit: "write-audit" as const },
];

describe("withToolHooks", () => {
  it("adds the hooks to empty settings", () => {
    const { settings, added } = withToolHooks({}, CLAUDE, "claude", "markbase");
    expect(added).toBe(3);
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: "markbase write-audit --agent claude" }],
          },
        ],
        PostToolUse: [
          { matcher: "Read", hooks: [{ type: "command", command: "markbase read-audit --agent claude" }] },
          {
            matcher: "Edit|Write|MultiEdit",
            hooks: [{ type: "command", command: "markbase write-audit --agent claude" }],
          },
        ],
      },
    });
  });

  it("keeps other settings and other hooks, and adds nothing twice", () => {
    const mine = {
      model: "opus",
      hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./lint.sh" }] }] },
    };
    const first = withToolHooks(mine, CLAUDE, "claude", "markbase");
    expect(first.settings.model).toBe("opus");
    const post = first.settings.hooks;
    expect(JSON.stringify(post)).toContain("./lint.sh");

    const second = withToolHooks(first.settings, CLAUDE, "claude", "npx -y @markbase/cli");
    expect(second.added).toBe(0);
    expect(second.settings).toEqual(first.settings);
  });
});

describe("withCursorHooks", () => {
  it("adds both hooks with the version Cursor wants, once", () => {
    const first = withCursorHooks({ hooks: { stop: [{ command: "./done.sh" }] } }, "markbase");
    expect(first.added).toBe(2);
    expect(first.settings).toEqual({
      version: 1,
      hooks: {
        stop: [{ command: "./done.sh" }],
        beforeReadFile: [{ command: "markbase read-audit --agent cursor" }],
        afterFileEdit: [{ command: "markbase write-audit --agent cursor" }],
      },
    });
    expect(withCursorHooks(first.settings, "markbase").added).toBe(0);
  });
});
