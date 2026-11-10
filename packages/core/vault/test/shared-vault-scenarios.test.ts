import { describe, it, expect, afterEach } from "vitest";
import { baseStoreDir, locksDir } from "../src/markbase-home";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import * as Y from "yjs";
import { getMarkdown, setMarkdown, type DocStore, type DocPubSub } from "@markbase/docs";
import { SHARED_VAULT_ID } from "@markbase/protocol/shared-vault";
import { readVaultIndex } from "../src/vault-index";
import {
  startVaultSync,
  type DocSummary,
  type ForkControl,
  type LocalFork,
  type VaultWatcher,
} from "../src/vault-sync-run";

process.env.MARKBASE_HOME = mkdtempSync(join(tmpdir(), "mb-home-shared-"));

// The Shared Vault (docs/shared-vault.md), driven through the real daemon with
// the same four seams faked as vault-sync-scenarios.test.ts: the CRDT store,
// the document list (shaped as GET /docs?scope=shared answers), the adopt
// call, and the watcher. The API the daemon reaches over HTTP — leaving a
// share, filing a document, a document's media — is served by a stub that
// records what it was asked.

class FakeStore implements DocStore {
  readonly blobs = new Map<string, Uint8Array>();
  readonly saved: string[] = [];
  async load(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async save(id: string, snap: Uint8Array): Promise<void> {
    this.saved.push(id);
    this.blobs.set(id, snap);
  }
  /** What the cloud holds for a document, as markdown. */
  markdown(id: string): string | null {
    const b = this.blobs.get(id);
    if (!b) return null;
    const d = new Y.Doc();
    Y.applyUpdate(d, b);
    return getMarkdown(d);
  }
}

class FakeBus implements DocPubSub {
  private readonly subs = new Map<string, Set<(u: Uint8Array) => void>>();
  publish(id: string, update: Uint8Array): void {
    for (const h of this.subs.get(id) ?? []) h(update);
  }
  subscribe(id: string, onUpdate: (u: Uint8Array) => void): () => void {
    let set = this.subs.get(id);
    if (!set) this.subs.set(id, (set = new Set()));
    set.add(onUpdate);
    return () => {
      set?.delete(onUpdate);
    };
  }
}

class TestWatcher implements VaultWatcher {
  private readonly handlers = new Map<string, Array<(p: string) => void>>();
  on(event: "add" | "change" | "unlink", cb: (p: string) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }
  async close(): Promise<void> {}
  emit(event: "add" | "change" | "unlink", absPath: string): void {
    for (const cb of this.handlers.get(event) ?? []) cb(absPath);
  }
}

type Cap = "editor" | "commenter" | "viewer";

/** The cloud as the shared list shows it: other people's documents, shared with me. */
class SharedCloud {
  readonly store = new FakeStore();
  readonly bus = new FakeBus();
  docs: DocSummary[] = [];
  readonly adoptCalls: string[] = [];
  private next = 0;

  /** The owner creates and opens a document, then shares it with me. */
  share(owner: string, title: string, markdown: string, capability: Cap, opts: { opened?: boolean } = {}): string {
    const id = `doc-${++this.next}`;
    const opened = opts.opened ?? true;
    if (opened) {
      const doc = new Y.Doc();
      setMarkdown(doc, markdown);
      this.store.blobs.set(id, Y.encodeStateAsUpdate(doc));
    }
    this.docs.push({
      id,
      title,
      content: markdown,
      path: `${owner}/${title}.md`,
      owner_path: `notes/${title}.md`,
      owner_name: owner,
      capability,
      has_crdt: opened,
      vault_id: `vault-of-${owner}`,
    });
    return id;
  }

  /** An editor (or the owner) changes the document; the bus carries it live. */
  edit(id: string, markdown: string): void {
    const d = new Y.Doc();
    const prev = this.store.blobs.get(id);
    if (prev) Y.applyUpdate(d, prev);
    const before = Y.encodeStateVector(d);
    setMarkdown(d, markdown);
    this.store.blobs.set(id, Y.encodeStateAsUpdate(d));
    this.bus.publish(id, Y.encodeStateAsUpdate(d, before));
  }

  find(id: string): DocSummary {
    return this.docs.find((d) => d.id === id) as DocSummary;
  }

  list = async (withContent: boolean): Promise<DocSummary[]> =>
    this.docs.map((d) => ({ ...d, content: withContent ? d.content : undefined }));

  adopt = async (path: string): Promise<string | null> => {
    this.adoptCalls.push(path);
    return null;
  };
}

/** The API calls the Shared Vault makes over HTTP. */
class FakeApp {
  readonly left: string[] = [];
  readonly filed: Array<{ id: string; path: string | null }> = [];
  readonly docPatches: string[] = [];
  readonly docDeletes: string[] = [];
  readonly assetLists: string[] = [];
  /** doc id → the media its markdown references, as the API would answer. */
  assets = new Map<string, Array<{ path: string; sha256: string; bytes: Buffer }>>();
  onLeave: (id: string) => void = () => {};
  onFile: (id: string, path: string | null) => void = () => {};
  private server?: Server;
  url = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      const member = /^\/api\/v1\/docs\/([^/]+)\/membership$/.exec(url.pathname);
      const doc = /^\/api\/v1\/docs\/([^/]+)$/.exec(url.pathname);
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (member && req.method === "DELETE") {
          const id = decodeURIComponent(member[1]);
          this.left.push(id);
          this.onLeave(id);
          res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
          return;
        }
        if (member && req.method === "PATCH") {
          const id = decodeURIComponent(member[1]);
          const path = (JSON.parse(body || "{}") as { path?: string | null }).path ?? null;
          this.filed.push({ id, path });
          this.onFile(id, path);
          res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
          return;
        }
        if (doc && req.method === "PATCH") {
          this.docPatches.push(decodeURIComponent(doc[1]));
          res.writeHead(200).end('{"ok":true}');
          return;
        }
        if (doc && req.method === "DELETE") {
          this.docDeletes.push(decodeURIComponent(doc[1]));
          res.writeHead(403).end('{"error":"owner only"}');
          return;
        }
        if (doc && req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ doc: { content: "" } }));
          return;
        }
        if (url.pathname === "/api/v1/assets" && req.method === "GET") {
          const id = url.searchParams.get("doc") ?? "";
          this.assetLists.push(id);
          const urls = url.searchParams.get("urls") !== "0";
          const list = this.assets.get(id) ?? [];
          const etag = `"${list.map((a) => a.sha256).join(",")}|${urls ? 1 : 0}"`;
          if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { etag }).end();
            return;
          }
          res.writeHead(200, { "content-type": "application/json", etag }).end(
            JSON.stringify({
              assets: list.map((a) => ({ path: a.path, sha256: a.sha256, url: urls ? `${this.url}/blob/${a.sha256}` : null })),
            })
          );
          return;
        }
        const blob = /^\/blob\/([0-9a-f]+)$/.exec(url.pathname);
        if (blob) {
          for (const list of this.assets.values()) {
            const hit = list.find((a) => a.sha256 === blob[1]);
            if (hit) {
              res.writeHead(200).end(hit.bytes);
              return;
            }
          }
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => {
        this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }
  close(): void {
    this.server?.close();
  }
}

const dirs: string[] = [];
const stops: Array<() => Promise<void>> = [];
const apps: FakeApp[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop().catch(() => {});
  for (const d of dirs.splice(0)) {
    // Read-only files are ours to remove; rmSync needs the write bit on the dir, not the file.
    rmSync(d, { recursive: true, force: true });
  }
  for (const a of apps.splice(0)) a.close();
  rmSync(join(locksDir(), `${SHARED_VAULT_ID}.json`), { force: true });
  try {
    for (const f of readdirSync(baseStoreDir())) {
      if (f.startsWith(SHARED_VAULT_ID)) rmSync(join(baseStoreDir(), f), { force: true });
    }
  } catch {
    // no base store yet
  }
});

async function sharedVault() {
  const dir = mkdtempSync(join(tmpdir(), "shared-vault-"));
  dirs.push(dir);
  const app = new FakeApp();
  await app.start();
  apps.push(app);
  const cloud = new SharedCloud();
  app.onLeave = (id) => {
    cloud.docs = cloud.docs.filter((d) => d.id !== id);
  };
  app.onFile = (id, path) => {
    const d = cloud.docs.find((x) => x.id === id);
    if (d && path) d.path = path;
  };
  const watcher = new TestWatcher();
  const forkEvents: Array<{ forks: LocalFork[]; fresh: LocalFork[] }> = [];
  let control: ForkControl | null = null;
  const log: string[] = [];
  return {
    dir,
    app,
    cloud,
    watcher,
    forkEvents,
    log,
    control: () => control as ForkControl,
    start: async (ownerId = "member-1") => {
      const stop = await startVaultSync({
        dir,
        vaultId: SHARED_VAULT_ID,
        // The Shared Vault belongs to whoever mounted it: the account check
        // binds it to the key's owner, which these scenarios hold fixed
        // unless one says otherwise.
        ownerId,
        appUrl: app.url,
        apiKey: "test-key",
        lockOwner: "test",
        reconcileMs: 100,
        checkpointMs: 50,
        store: cloud.store,
        pubsub: cloud.bus,
        listDocs: cloud.list,
        adopt: cloud.adopt,
        watch: () => watcher,
        author: "me",
        log: (m) => log.push(m),
        sharedHost: {
          onForks: (forks, fresh) => forkEvents.push({ forks, fresh }),
          attach: (c) => {
            control = c;
          },
        },
      });
      stops.push(stop);
      return stop;
    },
    read: (p: string) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8") : null),
    mode: (p: string) => statSync(join(dir, p)).mode & 0o777,
    /** Write a file the way a person who has forced past read-only does (vim :w!). */
    force: (p: string, content: string) => {
      const abs = join(dir, p);
      mkdirSync(dirname(abs), { recursive: true });
      const existed = existsSync(abs);
      if (existed) chmodSync(abs, 0o644);
      writeFileSync(abs, content);
      watcher.emit(existed ? "change" : "add", abs);
    },
    remove: (p: string) => {
      unlinkSync(join(dir, p));
      watcher.emit("unlink", join(dir, p));
    },
  };
}

async function waitFor(what: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    if (what()) return;
    if (Date.now() > until) throw new Error("timed out waiting for the daemon");
    await new Promise((r) => setTimeout(r, 20));
  }
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 400));

describe("the Shared Vault mirrors what others shared", () => {
  it("lays each document out by owner and title, read-only for a viewer, writable for an editor", async () => {
    const v = await sharedVault();
    v.cloud.share("Ada", "Plan", "# Plan\n", "viewer");
    v.cloud.share("Ada", "Notes", "# Notes\n", "editor");
    v.cloud.share("Bob", "Plan", "# Bob's plan\n", "commenter");
    await v.start();
    expect(v.read("Ada/Plan.md")).toBe("# Plan\n");
    expect(v.read("Ada/Notes.md")).toBe("# Notes\n");
    expect(v.read("Bob/Plan.md")).toBe("# Bob's plan\n");
    expect(v.mode("Ada/Plan.md")).toBe(0o444);
    expect(v.mode("Bob/Plan.md")).toBe(0o444);
    expect(v.mode("Ada/Notes.md") & 0o200).toBe(0o200);
    const index = readVaultIndex(v.dir);
    expect(index?.vaultId).toBe(SHARED_VAULT_ID);
    expect(index?.docs.find((d) => d.file === "Ada/Plan.md")?.capability).toBe("viewer");
    expect(index?.docs.find((d) => d.file === "Ada/Notes.md")?.capability).toBe("editor");
    // The viewer's replicas never saved; the editor's document was not changed, so nothing saved at all.
    expect(v.cloud.store.saved).toEqual([]);
  });

  it("still writes a viewer's file when the cloud changes it, and keeps it read-only", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n", "viewer");
    await v.start();
    v.cloud.edit(id, "# Plan\n\n- step one\n");
    await waitFor(() => v.read("Ada/Plan.md") === "# Plan\n\n- step one\n");
    expect(v.mode("Ada/Plan.md")).toBe(0o444);
    expect(v.cloud.store.saved).toEqual([]);
  });

  it("sends an editor's file edit up, as in any vault", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Notes", "# Notes\n", "editor");
    await v.start();
    v.force("Ada/Notes.md", "# Notes\n\nmine\n");
    await waitFor(() => v.cloud.store.markdown(id) === "# Notes\n\nmine\n");
    expect(v.forkEvents.flatMap((e) => e.forks)).toEqual([]);
  });

  it("does not adopt a file dropped into the folder", async () => {
    const v = await sharedVault();
    v.cloud.share("Ada", "Plan", "# Plan\n", "editor");
    v.force("stray.md", "# stray\n"); // present before start
    await v.start();
    v.force("Ada/another.md", "# another\n"); // and one while running
    await settle();
    expect(v.cloud.adoptCalls).toEqual([]);
    expect(v.read("stray.md")).toBe("# stray\n"); // left alone, not removed
    expect(v.log.some((l) => /not adopting stray.md/.test(l))).toBe(true);
  });

  it("waits for a read-only document nobody has opened yet, and mirrors it once someone has", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Draft", "# Draft\n", "viewer", { opened: false });
    await v.start();
    expect(v.read("Ada/Draft.md")).toBeNull();
    expect(v.log.some((l) => /nobody has opened it yet/.test(l))).toBe(true);
    // The owner opens it: the CRDT is born.
    const doc = new Y.Doc();
    setMarkdown(doc, "# Draft\n");
    v.cloud.store.blobs.set(id, Y.encodeStateAsUpdate(doc));
    v.cloud.find(id).has_crdt = true;
    await waitFor(() => v.read("Ada/Draft.md") === "# Draft\n");
    expect(v.mode("Ada/Draft.md")).toBe(0o444);
  });

  it("an editor's unopened document is seeded, as the owner's daemon would", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Draft", "# Draft\n", "editor", { opened: false });
    await v.start();
    expect(v.read("Ada/Draft.md")).toBe("# Draft\n");
    expect(v.cloud.store.markdown(id)).toBe("# Draft\n");
  });
});

describe("files that go away", () => {
  it("a deleted file leaves the share, and never deletes the document", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n", "editor");
    await v.start();
    v.remove("Ada/Plan.md");
    await waitFor(() => v.app.left.includes(id));
    await settle();
    expect(v.app.docDeletes).toEqual([]);
    expect(v.read("Ada/Plan.md")).toBeNull();
  });

  it("a document no longer shared leaves the folder — into .trash, edits and all", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n", "viewer");
    await v.start();
    v.force("Ada/Plan.md", "# Plan\n\nmy note\n");
    await waitFor(() => v.forkEvents.length > 0);
    v.cloud.docs = v.cloud.docs.filter((d) => d.id !== id); // revoked
    await waitFor(() => v.read("Ada/Plan.md") === null);
    expect(v.read(".trash/Ada/Plan.md")).toBe("# Plan\n\nmy note\n");
    expect(v.mode(".trash/Ada/Plan.md") & 0o200).toBe(0o200); // theirs to edit now
    await waitFor(() => v.forkEvents[v.forkEvents.length - 1].forks.length === 0);
  });
});

describe("filing", () => {
  it("a rename on disk is saved on the membership, never on the owner's document", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n", "viewer");
    await v.start();
    const from = join(v.dir, "Ada/Plan.md");
    const to = join(v.dir, "Ada/Q4 plan.md");
    // A read-only file renames fine: the write bit that matters is the folder's.
    const { renameSync } = await import("node:fs");
    renameSync(from, to);
    v.watcher.emit("unlink", from);
    v.watcher.emit("add", to);
    await waitFor(() => v.app.filed.some((f) => f.id === id && f.path === "Ada/Q4 plan.md"));
    expect(v.app.docPatches).toEqual([]);
    await settle();
    expect(v.read("Ada/Q4 plan.md")).toBe("# Plan\n");
    expect(v.read("Ada/Plan.md")).toBeNull();
    expect(v.mode("Ada/Q4 plan.md")).toBe(0o444);
  });
});

describe("a viewer who edits anyway: the live fork", () => {
  it("keeps the edit, never saves it, reports it once, and records it in the index", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n", "viewer");
    await v.start();
    v.force("Ada/Plan.md", "# Plan\n\nmy note\n");
    await waitFor(() => v.forkEvents.length === 1);
    const [ev] = v.forkEvents;
    expect(ev.fresh).toHaveLength(1);
    expect(ev.fresh[0]).toMatchObject({ docId: id, path: "Ada/Plan.md", title: "Plan" });
    expect(ev.forks).toEqual(ev.fresh);
    expect(v.read("Ada/Plan.md")).toBe("# Plan\n\nmy note\n");
    expect(v.mode("Ada/Plan.md")).toBe(0o444); // back to read-only after our write
    await settle();
    expect(v.cloud.store.saved).toEqual([]);
    expect(v.cloud.store.markdown(id)).toBe("# Plan\n");
    expect(readVaultIndex(v.dir)?.docs.find((d) => d.id === id)?.fork?.since).toBe(ev.fresh[0].since);
    // Editing it again is the same fork, not a second one.
    v.force("Ada/Plan.md", "# Plan\n\nmy note, longer\n");
    await settle();
    expect(v.forkEvents).toHaveLength(1);
  });

  it("merges the cloud's later edits into the fork and keeps both on disk", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n\n- alpha\n", "viewer");
    await v.start();
    v.force("Ada/Plan.md", "# Plan\n\n- alpha\n- mine\n");
    await waitFor(() => v.forkEvents.length === 1);
    v.cloud.edit(id, "# Plan v2\n\n- alpha\n");
    await waitFor(() => (v.read("Ada/Plan.md") ?? "").includes("Plan v2"));
    expect(v.read("Ada/Plan.md")).toContain("- mine");
    expect(v.control().compare(id)).toMatchObject({ cloud: "# Plan v2\n\n- alpha\n", title: "Plan" });
  });

  it("compare, then discard: the file is the cloud's again and the fork is gone", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n", "viewer");
    await v.start();
    v.force("Ada/Plan.md", "# Plan\n\nmy note\n");
    await waitFor(() => v.forkEvents.length === 1);
    expect(v.control().list().map((f) => f.docId)).toEqual([id]);
    expect(v.control().compare(id)).toMatchObject({ cloud: "# Plan\n", local: "# Plan\n\nmy note\n", path: "Ada/Plan.md" });
    expect(v.control().discard(id)).toBe(true);
    expect(v.read("Ada/Plan.md")).toBe("# Plan\n");
    expect(v.control().list()).toEqual([]);
    expect(v.forkEvents[v.forkEvents.length - 1].forks).toEqual([]);
    expect(readVaultIndex(v.dir)?.docs.find((d) => d.id === id)?.fork).toBeUndefined();
    expect(v.control().compare(id)).toBeNull();
  });

  it("survives a restart as the same fork — not news a second time", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n", "viewer");
    const stop = await v.start();
    v.force("Ada/Plan.md", "# Plan\n\nmy note\n");
    await waitFor(() => v.forkEvents.length === 1);
    const since = v.forkEvents[0].fresh[0].since;
    await stop();
    stops.splice(stops.indexOf(stop), 1);

    v.forkEvents.length = 0;
    await v.start();
    expect(v.read("Ada/Plan.md")).toBe("# Plan\n\nmy note\n");
    expect(v.cloud.store.markdown(id)).toBe("# Plan\n");
    expect(v.forkEvents).toHaveLength(1);
    expect(v.forkEvents[0].fresh).toEqual([]);
    expect(v.forkEvents[0].forks[0]).toMatchObject({ docId: id, since });
  });

  it("lands when the person is made an editor: one save, file writable", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n", "viewer");
    await v.start();
    v.force("Ada/Plan.md", "# Plan\n\nmy note\n");
    await waitFor(() => v.forkEvents.length === 1);
    v.cloud.find(id).capability = "editor";
    await waitFor(() => v.cloud.store.markdown(id) === "# Plan\n\nmy note\n");
    await waitFor(() => (v.mode("Ada/Plan.md") & 0o200) === 0o200);
    await waitFor(() => v.forkEvents[v.forkEvents.length - 1].forks.length === 0);
    expect(v.log.some((l) => /Ada\/Plan.md is editable for you now/.test(l))).toBe(true);
  });
});

describe("a shared document's media", () => {
  it("fetches the images the document references, written where the member's copy expects them", async () => {
    const v = await sharedVault();
    const id = v.cloud.share("Ada", "Plan", "# Plan\n\n![d](img/d.png)\n", "viewer");
    const bytes = Buffer.from("png-bytes");
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // The owner's path is notes/Plan.md, so the image sits at notes/img/d.png in THEIR vault.
    v.app.assets.set(id, [{ path: "notes/img/d.png", sha256, bytes }]);
    await v.start();
    // Here the document is Ada/Plan.md, so the same reference resolves to Ada/img/d.png.
    await waitFor(() => existsSync(join(v.dir, "Ada/img/d.png")));
    expect(readFileSync(join(v.dir, "Ada/img/d.png"))).toEqual(bytes);
    // Later passes revalidate rather than refetch.
    const before = v.app.assetLists.length;
    await settle();
    expect(v.app.assetLists.length).toBeGreaterThan(before);
    expect(v.app.assetLists.every((d) => d === id)).toBe(true);
  });
});

// The Shared Vault is not a row the API can be asked about, so whose folder it
// is comes from what is in it: the account the documents were shared with is
// the one whose shared listing names them. A second account signing in on the
// same machine (2026-10-30) must not take over the first account's folder.
describe("the Shared Vault belongs to the account whose documents it holds", () => {
  it("refuses a key whose shared listing names none of the folder's documents, and touches nothing", async () => {
    const v = await sharedVault();
    v.cloud.share("Ada", "Plan", "# Plan\n", "editor");
    await v.start();
    await waitFor(() => v.read("Ada/Plan.md") !== null);
    for (const stop of stops.splice(0)) await stop();
    // Mounted before owners were recorded: the marker names no account.
    writeFileSync(join(v.dir, ".markbase", "vault.json"), JSON.stringify({ vaultId: SHARED_VAULT_ID }));

    // Another account, with nothing shared to it.
    v.cloud.docs = [];
    await expect(v.start("member-2")).rejects.toThrow(/mounted by another account/);
    expect(v.read("Ada/Plan.md")).toContain("# Plan");
    expect(existsSync(join(v.dir, ".trash"))).toBe(false);
  });

  it("binds the folder to the account whose listing names its documents, and records it", async () => {
    const v = await sharedVault();
    v.cloud.share("Ada", "Plan", "# Plan\n", "editor");
    await v.start();
    await waitFor(() => v.read("Ada/Plan.md") !== null);
    for (const stop of stops.splice(0)) await stop();
    writeFileSync(join(v.dir, ".markbase", "vault.json"), JSON.stringify({ vaultId: SHARED_VAULT_ID }));

    await v.start("member-1");
    expect(JSON.parse(readFileSync(join(v.dir, ".markbase", "vault.json"), "utf8"))).toEqual({
      vaultId: SHARED_VAULT_ID,
      ownerId: "member-1",
    });
  });
});
