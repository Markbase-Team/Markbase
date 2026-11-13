import { describe, it, expect } from "vitest";
import { agentLabel, listVersions, versionContent, versionCreditText } from "../src/logic/versions";
import type { DocStore, DocPubSub } from "../src/logic/transport";
import { VaultSync, type AgentCredit, type VaultSyncFs } from "../src/logic/vault-sync";

// A version says which agent wrote it, when the agent's hook reported the
// write. VaultSync only ASKS who wrote a change (the answer is the vault's
// agent audit); here the answer is a table of contents an agent "wrote".

class FakeStore implements DocStore {
  private blobs = new Map<string, Uint8Array>();
  async load(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async save(id: string, snap: Uint8Array): Promise<void> {
    this.blobs.set(id, snap);
  }
}

class FakeBus implements DocPubSub {
  private subs = new Map<string, Set<(u: Uint8Array) => void>>();
  publish(id: string, u: Uint8Array): void {
    for (const h of this.subs.get(id) ?? []) h(u);
  }
  subscribe(id: string, onUpdate: (u: Uint8Array) => void): () => void {
    let set = this.subs.get(id);
    if (!set) {
      set = new Set();
      this.subs.set(id, set);
    }
    set.add(onUpdate);
    return () => set.delete(onUpdate);
  }
}

/** An in-memory disk that counts writes, so "did a checkpoint touch the file?"
 *  is answerable without a real filesystem. */
class FakeFs implements VaultSyncFs {
  readonly files = new Map<string, string>();
  writes = 0;
  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }
  write(path: string, content: string): void {
    this.writes++;
    this.files.set(path, content);
  }
}

const PATH = "note.md";
const MIN = 60_000;
/** Past the 2-minute idle window, so the cadence rules say "a thought finished". */
const settled = (): number => Date.now() + 3 * MIN;


/** A credit that knows, per file content, which agent wrote it — now, or only later. */
function creditFrom(now: Record<string, string>, later: Record<string, string> = {}): AgentCredit {
  return (content) => ({ agent: now[content] ?? null, later: () => now[content] ?? later[content] ?? null });
}

async function open(credit: AgentCredit): Promise<{ vs: VaultSync; fs: FakeFs }> {
  const fs = new FakeFs();
  fs.files.set(PATH, "# Note\n");
  const vs = await VaultSync.open("d1", PATH, new FakeStore(), new FakeBus(), fs);
  vs.trackVersions("Jessie", credit);
  return { vs, fs };
}

function edit(vs: VaultSync, fs: FakeFs, content: string): void {
  fs.files.set(PATH, content);
  vs.fileChanged();
}

const BY_CLAUDE = "# Note\n\nwritten by Claude\n";
const BY_JESSIE = "# Note\n\nwritten by Claude\n\nand Jessie\n";
const BY_CODEX = "# Note\n\nwritten by Claude\n\nand Jessie\n\nand Codex\n";

describe("VaultSync agent credit", () => {
  it("credits a version to the agent that wrote the file", async () => {
    const { vs, fs } = await open(creditFrom({ [BY_CLAUDE]: "claude" }));
    edit(vs, fs, BY_CLAUDE);

    expect(vs.maybeCheckpoint(settled())).toBe(true);
    const v = listVersions(vs.doc)[1];
    expect(v).toMatchObject({ author: "Jessie", agents: ["claude"] });
    expect(v.mixed).toBeUndefined();
    expect(versionCreditText(v)).toBe("Claude Code");
    vs.close();
  });

  it("gives text that was there before the agent's first write its own version", async () => {
    // The file was adopted with content and has no history yet.
    const { vs, fs } = await open(creditFrom({ [BY_CLAUDE]: "claude" }));
    edit(vs, fs, BY_CLAUDE);
    vs.maybeCheckpoint(settled());

    const versions = listVersions(vs.doc);
    expect(versions.map((v) => versionCreditText(v))).toEqual(["Jessie", "Claude Code"]);
    expect(versionContent(vs.doc, 0)).toBe("# Note\n");
    vs.close();
  });

  it("leaves a version the person wrote as the person's", async () => {
    const { vs, fs } = await open(creditFrom({}));
    edit(vs, fs, BY_CLAUDE);

    expect(vs.maybeCheckpoint(settled())).toBe(true);
    const [v] = listVersions(vs.doc);
    expect(v.agents).toBeUndefined();
    expect(versionCreditText(v)).toBe("Jessie");
    vs.close();
  });

  it("cuts a version when the writer changes, so each is one writer's work", async () => {
    const { vs, fs } = await open(creditFrom({ [BY_CLAUDE]: "claude", [BY_CODEX]: "codex" }));
    edit(vs, fs, BY_CLAUDE);
    edit(vs, fs, BY_JESSIE); // the person, right after: Claude's version is cut here
    edit(vs, fs, BY_CODEX); // another agent: the person's is cut here
    vs.maybeCheckpoint(settled());

    const versions = listVersions(vs.doc);
    expect(versions.map((v) => versionCreditText(v))).toEqual(["Jessie", "Claude Code", "Jessie", "Codex"]);
    expect(versionContent(vs.doc, 1)).toBe(BY_CLAUDE);
    expect(versionContent(vs.doc, 2)).toBe(BY_JESSIE);
    expect(versionContent(vs.doc, 3)).toBe(BY_CODEX);
    vs.close();
  });

  it("asks again at the version for a write whose record landed late", async () => {
    // The watcher beat the agent's hook: nothing is known as the file changes.
    const { vs, fs } = await open(creditFrom({}, { [BY_CLAUDE]: "cursor" }));
    edit(vs, fs, BY_CLAUDE);

    vs.maybeCheckpoint(settled());
    expect(versionCreditText(listVersions(vs.doc)[0])).toBe("Cursor");
    vs.close();
  });

  it("says so when a version holds both the person's edits and an agent's", async () => {
    // Neither is known as it arrives, so no version is cut between them.
    const { vs, fs } = await open(creditFrom({}, { [BY_CLAUDE]: "cursor" }));
    edit(vs, fs, BY_CLAUDE);
    edit(vs, fs, BY_JESSIE);

    vs.maybeCheckpoint(settled());
    const [v] = listVersions(vs.doc);
    expect(v).toMatchObject({ agents: ["cursor"], mixed: true });
    expect(versionCreditText(v)).toBe("Jessie + Cursor");
    vs.close();
  });

  it("names an agent it has no label for as it was given", () => {
    expect(agentLabel("aider")).toBe("aider");
    expect(agentLabel("Claude")).toBe("Claude Code");
  });
});
