import { describe, expect, it } from "vitest";
import type { VaultSyncFs } from "@markbase/shared/docs";
import type { HookEvent } from "@markbase/shared/analytics/hook-events";
import type { FileHookEvent } from "../../src/vault/agent-audit";
import type { AgentReads, OpenSyncedFile, SyncedFile } from "../../src/vault/synced-file";
import { VaultSyncManager, reportBatches } from "../../src/vault/vault-sync-manager";

// What agents' hooks saw of a vault's files goes to the server, one event
// each. A read the server did not record goes into its document's own tally
// instead — never both, or whoever adds the two would count it twice. A write
// has no tally to go to.

class MemFs implements VaultSyncFs {
  files = new Map<string, string>();
  read(p: string): string | null {
    return this.files.get(p) ?? null;
  }
  write(p: string, c: string): void {
    this.files.set(p, c);
  }
}

function fakeFile(docId: string, path: string, kept: AgentReads[], readOnly: boolean): SyncedFile {
  return {
    docId,
    path,
    readOnly,
    fileChanged: () => undefined,
    content: () => "",
    restore: () => undefined,
    rename: () => undefined,
    close: () => undefined,
    trackVersions: () => undefined,
    recordAgentReads: (reads) => {
      kept.push(...reads);
    },
    maybeCheckpoint: () => false,
    confirmPendingEmpty: () => false,
  };
}

const EVENTS: FileHookEvent[] = [
  { kind: "read", agent: "claude", path: "notes.md", at: 1_000 },
  { kind: "write", agent: "claude", path: "notes.md", at: 1_500 },
  { kind: "read", agent: "claude", path: "notes.md", at: 2_000 },
  { kind: "read", agent: "codex", path: "gone.md", at: 2_500 },
];

async function sweep(opts: {
  report?: (events: HookEvent[]) => Promise<boolean[] | null>;
  readOnly?: boolean;
}): Promise<{ kept: AgentReads[]; passed: number }> {
  const kept: AgentReads[] = [];
  const open: OpenSyncedFile = async ({ docId, path }) => fakeFile(docId, path, kept, opts.readOnly ?? false);
  const manager = await VaultSyncManager.open([{ id: "d1", path: "notes.md" }], new MemFs(), open, {
    author: "Jessie",
    hookEvents: () => EVENTS,
    reportHookEvents: opts.report,
  });
  const passed = manager.passOnHookEvents();
  // The sweep does not wait for the report; let it settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { kept, passed };
}

describe("passing on what agents' hooks saw", () => {
  it("reports each event as it happened, for the document it is about", async () => {
    const reported: HookEvent[][] = [];
    const { kept, passed } = await sweep({
      report: async (events) => {
        reported.push(events);
        return events.map(() => true);
      },
    });
    expect(reported).toEqual([
      [
        { kind: "read", agent: "claude", docId: "d1", at: 1_000 },
        { kind: "write", agent: "claude", docId: "d1", at: 1_500 },
        { kind: "read", agent: "claude", docId: "d1", at: 2_000 },
      ],
    ]);
    expect(kept).toEqual([]);
    // The read of a file with no document here is dropped.
    expect(passed).toBe(3);
  });

  it("keeps only the reads the server did not record, in the document", async () => {
    const { kept } = await sweep({ report: async () => [true, false, false] });
    expect(kept).toEqual([{ agent: "claude", owner: "Jessie", count: 1, lastAt: 2_000 }]);
  });

  it("keeps every read in the document when the report gets no answer, and drops the write", async () => {
    for (const report of [async () => null, async () => Promise.reject(new Error("offline"))]) {
      expect((await sweep({ report })).kept).toEqual([{ agent: "claude", owner: "Jessie", count: 2, lastAt: 2_000 }]);
    }
  });

  it("keeps reads in the document when there is no way to report, or the file is read-only here", async () => {
    let asked = 0;
    const counting = async (events: HookEvent[]) => {
      asked++;
      return events.map(() => true);
    };
    expect((await sweep({})).kept).toEqual([{ agent: "claude", owner: "Jessie", count: 2, lastAt: 2_000 }]);
    expect((await sweep({ readOnly: true, report: counting })).kept).toHaveLength(1);
    expect(asked).toBe(0);
  });
});

describe("reportBatches", () => {
  const item = (docId: string) => ({ event: { kind: "read" as const, agent: "claude", docId, at: 1 } });

  it("splits at the most events a report may carry", () => {
    const batches = reportBatches(Array.from({ length: 1_201 }, () => item("d1")));
    expect(batches.map((b) => b.length)).toEqual([500, 500, 201]);
  });

  it("splits at the most documents a report may name", () => {
    const batches = reportBatches(Array.from({ length: 120 }, (_, i) => item(`d${i}`)));
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
  });
});
