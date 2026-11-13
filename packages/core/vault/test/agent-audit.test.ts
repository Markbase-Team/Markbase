import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentCredit,
  countReads,
  countWrites,
  findVaultFile,
  readReadEvents,
  readWriteEvents,
  recordReads,
  recordWrites,
  shellReads,
  snapshotWrites,
  undoEdits,
  writesLedgerPath,
} from "../src/agent-audit";
import type { HookCall, HookWrite } from "../src/agent-hook";
import type { MountedVault } from "../src/vault-registry";

// The ledger end to end, on a real temporary disk: a vault folder, a Markbase
// home for the ledger, and calls shaped like the ones the hook parser makes.

let home: string;
let dir: string;
let vaults: MountedVault[];
const savedHome = process.env.MARKBASE_HOME;

beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "markbase-audit-")));
  home = join(root, "home");
  dir = join(root, "vault");
  mkdirSync(join(dir, "notes"), { recursive: true });
  mkdirSync(join(dir, ".conflicts"), { recursive: true });
  process.env.MARKBASE_HOME = home;
  vaults = [{ vaultId: "v1", name: "Team", dir }];
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.MARKBASE_HOME;
  else process.env.MARKBASE_HOME = savedHome;
  rmSync(join(home, ".."), { recursive: true, force: true });
});

function call(agent: string, parts: Partial<HookCall>): HookCall {
  return {
    agent,
    session: "s1",
    event: "PostToolUse",
    phase: "after",
    tool: null,
    reads: [],
    writes: [],
    shell: null,
    cwd: dir,
    ...parts,
  };
}

describe("findVaultFile", () => {
  it("finds a file in a vault, by its path inside it", () => {
    expect(findVaultFile(join(dir, "notes", "plan.md"), vaults)).toEqual({
      vaultId: "v1",
      vault: "Team",
      path: "notes/plan.md",
    });
  });

  it("ignores files outside every vault, the vault folder itself, and dot-directories", () => {
    expect(findVaultFile(join(dir, "..", "elsewhere.md"), vaults)).toBeNull();
    expect(findVaultFile(dir, vaults)).toBeNull();
    expect(findVaultFile(join(dir, ".conflicts", "plan.md"), vaults)).toBeNull();
  });
});

describe("reads", () => {
  it("counts each read by file and by agent", () => {
    const plan = join(dir, "notes", "plan.md");
    writeFileSync(plan, "x");
    recordReads(call("claude", { tool: "Read", reads: [plan] }), vaults);
    recordReads(call("claude", { tool: "Read", reads: [plan] }), vaults);
    recordReads(call("cursor", { tool: null, reads: [plan] }), vaults);
    recordReads(call("codex", { tool: "Read", reads: [join(dir, "..", "outside.md")] }), vaults);

    const counts = countReads(readReadEvents());
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatchObject({ vault: "Team", path: "notes/plan.md", total: 3, byAgent: { claude: 2, cursor: 1 } });
  });

  it("finds a vault file named in a shell command, and marks the read inferred", () => {
    writeFileSync(join(dir, "notes", "plan.md"), "x");
    expect(shellReads("sed -n '1,40p' notes/plan.md | head", dir, vaults)).toEqual([join(dir, "notes", "plan.md")]);
    expect(shellReads("ls notes && echo plan.md", dir, vaults)).toEqual([]);

    const events = recordReads(call("codex", { tool: "Bash", shell: "cat notes/plan.md" }), vaults);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agent: "codex", path: "notes/plan.md", inferred: true });
  });
});

describe("writes", () => {
  const before = "# Plan\n\nShip on Monday.\n";
  const after = "# Plan\n\nShip on Friday.\n";
  let plan: string;
  let write: HookWrite;

  beforeEach(() => {
    plan = join(dir, "notes", "plan.md");
    writeFileSync(plan, before);
    write = { file: plan, edits: null };
  });

  it("measures against the snapshot taken before the tool ran", () => {
    expect(snapshotWrites(call("codex", { phase: "before", tool: "apply_patch", writes: [write] }), vaults)).toBe(1);
    writeFileSync(plan, after);
    const [event] = recordWrites(call("codex", { tool: "apply_patch", writes: [write] }), vaults);

    expect(event).toMatchObject({ agent: "codex", vault: "Team", path: "notes/plan.md", baseline: "snapshot" });
    const changes = event.changes ?? [];
    expect(changes).toHaveLength(1);
    expect(before.slice(changes[0].oldStart, changes[0].oldStart + changes[0].removed.length)).toBe(changes[0].removed);
    expect(after.slice(changes[0].newStart, changes[0].newStart + changes[0].inserted.length)).toBe(changes[0].inserted);
    // The snapshot is used once: a second write without one has no baseline.
    writeFileSync(plan, before);
    expect(recordWrites(call("codex", { writes: [write] }), vaults)[0].baseline).toBe("none");
  });

  it("measures against the original the tool hands back", () => {
    writeFileSync(plan, after);
    const [event] = recordWrites(call("claude", { tool: "Write", writes: [{ ...write, before }] }), vaults);
    expect(event.baseline).toBe("tool");
    expect(event.inserted).toBeGreaterThan(0);
  });

  it("measures a new file as all inserted", () => {
    const fresh = join(dir, "notes", "new.md");
    writeFileSync(fresh, "hello");
    const [event] = recordWrites(call("claude", { tool: "Write", writes: [{ file: fresh, edits: null, before: null }] }), vaults);
    expect(event).toMatchObject({ inserted: 5, removed: 0 });
    expect(event.changes).toEqual([{ oldStart: 0, newStart: 0, removed: "", inserted: "hello" }]);
  });

  it("measures by undoing the tool's own replacements when that is all there is", () => {
    writeFileSync(plan, after);
    const edits = [{ oldText: "Monday", newText: "Friday", replaceAll: false }];
    const [event] = recordWrites(call("cursor", { writes: [{ file: plan, edits }] }), vaults);
    expect(event.baseline).toBe("edits");
    expect(event.changes?.[0].oldStart).toBe(before.indexOf("Mon"));
  });

  it("still records who wrote which file when nothing says what it was before", () => {
    writeFileSync(plan, after);
    const [event] = recordWrites(call("codex", { tool: "apply_patch", writes: [write] }), vaults);
    expect(event).toMatchObject({ baseline: "none", changes: null, inserted: null, removed: null });
  });

  it("records nothing for a write that changed nothing, or one outside a vault", () => {
    expect(recordWrites(call("claude", { writes: [{ ...write, before }] }), vaults)).toEqual([]);
    const outside = join(dir, "..", "outside.md");
    writeFileSync(outside, "x");
    expect(recordWrites(call("claude", { writes: [{ file: outside, edits: null, before: "" }] }), vaults)).toEqual([]);
    expect(readWriteEvents()).toEqual([]);
  });

  it("totals writes per file and agent, and keeps the ledger private", () => {
    writeFileSync(plan, after);
    recordWrites(call("claude", { writes: [{ ...write, before }] }), vaults);
    writeFileSync(plan, before);
    recordWrites(call("codex", { writes: [write] }), vaults);

    const [count] = countWrites(readWriteEvents());
    expect(count.writes).toBe(2);
    expect(count.byAgent.claude.writes).toBe(1);
    expect(count.byAgent.claude.inserted).toBeGreaterThan(0);
    expect(count.byAgent.codex).toMatchObject({ writes: 1, unmeasured: 1 });
    expect(statSync(writesLedgerPath()).mode & 0o777).toBe(0o600);
    expect(readFileSync(writesLedgerPath(), "utf8").trim().split("\n")).toHaveLength(2);
  });
});

describe("undoEdits", () => {
  it("undoes edits last first", () => {
    const edits = [
      { oldText: "a", newText: "b", replaceAll: false },
      { oldText: "b c", newText: "B C", replaceAll: false },
    ];
    expect(undoEdits("B C d", edits)).toBe("a c d");
  });

  it("undoes a replace-all, and gives up when a replacement is not there", () => {
    expect(undoEdits("x-x-x", [{ oldText: "y", newText: "x", replaceAll: true }])).toBe("y-y-y");
    expect(undoEdits("nothing", [{ oldText: "a", newText: "zzz", replaceAll: false }])).toBeNull();
  });
});

describe("agentCredit", () => {
  const before = "# Plan\n\nShip on Monday.\n";
  const after = "# Plan\n\nShip on Friday.\n";
  let plan: string;

  beforeEach(() => {
    plan = join(dir, "notes", "plan.md");
    writeFileSync(plan, before);
  });

  it("credits content that is exactly what an agent's recorded write left", () => {
    writeFileSync(plan, after);
    recordWrites(call("claude", { writes: [{ file: plan, edits: null, before }] }), vaults);

    const credit = agentCredit(dir, () => "notes/plan.md");
    expect(credit(after).agent).toBe("claude");
    // The person typed on: not the agent's content any more.
    expect(credit(`${after}more\n`)).toMatchObject({ agent: null });
    expect(credit(`${after}more\n`).later()).toBeNull();
    // Another file with the same content is not this write.
    expect(agentCredit(dir, () => "notes/other.md")(after).agent).toBeNull();
  });

  it("credits a change while the agent's before-the-tool snapshot is fresh, then by the record", () => {
    const write = { file: plan, edits: null };
    snapshotWrites(call("codex", { phase: "before", writes: [write] }), vaults);
    const credit = agentCredit(dir, () => "notes/plan.md");

    // The watcher sees the file before the agent's after-hook has run.
    writeFileSync(plan, after);
    const early = credit(after);
    expect(early.agent).toBe("codex");

    recordWrites(call("codex", { writes: [write] }), vaults);
    expect(early.later()).toBe("codex");
    expect(credit(after).agent).toBe("codex");
  });

  it("finds a record that lands after the file changed", () => {
    writeFileSync(plan, after);
    const asked = agentCredit(dir, () => "notes/plan.md")(after);
    expect(asked.agent).toBeNull();

    recordWrites(call("cursor", { writes: [{ file: plan, edits: null, before }] }), vaults);
    expect(asked.later()).toBe("cursor");
  });
});
