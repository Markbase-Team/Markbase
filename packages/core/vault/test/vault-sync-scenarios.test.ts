import { describe, it, expect, afterEach } from "vitest";
import { baseStoreDir, locksDir } from "../src/markbase-home";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import * as Y from "yjs";
import { getMarkdown, setMarkdown, type DocStore, type DocPubSub } from "@markbase/docs";
import { startVaultSync, type DocSummary, type VaultWatcher } from "../src/vault-sync-run";
import { VaultNotOursError } from "../src/vault-account";
import { readVaultIndex } from "../src/vault-index";
import { readVaultMarkerInfo } from "../src/vault-fs";
import { addMountedVault, readMountedVaults } from "../src/vault-registry";

// A throwaway home. These tests write real lock files and sync bases, and doing
// that in the user's own ~/.markbaseConfig once created the directory early
// enough to break the migration that moves into it.
process.env.MARKBASE_HOME = mkdtempSync(join(tmpdir(), "mb-home-"));

// The four things a vault has to do, driven through the real daemon.
//
// Everything here is real except the outside world: a real folder on disk, the
// real reconcile loop, the real watcher handlers, real Yjs documents — with only
// the four seams faked (the CRDT transport, the document list, creating a
// document, and the file watcher).
//
// This is the layer where every sync bug has actually lived — the rename
// ping-pong, the self-adoption loop that turned 23 documents into 46 — and none
// of it was reachable from a test before those seams existed.

class FakeStore implements DocStore {
  readonly blobs = new Map<string, Uint8Array>();
  async load(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async save(id: string, snap: Uint8Array): Promise<void> {
    this.blobs.set(id, snap);
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

/** A watcher fired by hand, so a test never waits on the filesystem. */
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

/**
 * The cloud: a document list a test can mutate, plus the CRDT store the daemon
 * reads through.
 *
 * `createViaApi` writes BOTH — a row and a snapshot — because that is what the
 * real API does, and it is why a document made on the web arrives here with its
 * content rather than as an empty file.
 */
class FakeCloud {
  readonly store = new FakeStore();
  docs: DocSummary[] = [];
  /** Every path this daemon turned into a new document. */
  readonly adopted: string[] = [];
  private next = 0;

  createViaApi(path: string, markdown: string): string {
    const id = `cloud-${++this.next}`;
    const doc = new Y.Doc();
    setMarkdown(doc, markdown);
    this.store.blobs.set(id, Y.encodeStateAsUpdate(doc));
    this.docs.push({ id, title: path.replace(/\.md$/i, ""), path, content: markdown });
    return id;
  }

  deleteInCloud(path: string): void {
    this.docs = this.docs.filter((d) => d.path !== path);
  }

  setPath(id: string, path: string): void {
    const d = this.docs.find((x) => x.id === id);
    if (d) d.path = path;
  }

  deleteById(id: string): void {
    this.docs = this.docs.filter((d) => d.id !== id);
  }

  list = async (withContent: boolean): Promise<DocSummary[]> =>
    // The real list only carries markdown when asked; a test that always sent it
    // would hide the seeding path the daemon depends on.
    this.docs.map((d) => ({ ...d, content: withContent ? d.content : undefined }));

  /** Every adopt call's arguments, so a test can assert what the daemon asked for. */
  readonly adoptCalls: Array<{ path: string; content: string }> = [];

  adopt = async (path: string, content: string): Promise<string | null> => {
    this.adoptCalls.push({ path, content });
    this.adopted.push(path);
    const id = `local-${++this.next}`;
    this.docs.push({ id, title: path.replace(/\.md$/i, ""), path, content });
    return id;
  };
}

/**
 * The two asset endpoints the daemon talks to. Media has no injectable seam the
 * way the CRDT transport does — it goes over plain HTTP — so the test serves it
 * rather than mocking `fetch`, the same choice the device-auth tests make.
 */
class FakeAppServer {
  readonly uploaded: string[] = [];
  /** Documents the daemon asked to delete. */
  readonly deleted: string[] = [];
  /** Make DELETE fail, to test what happens when the deletion can't be recorded. */
  refuseDeletes = false;
  /** Make PATCH fail, to test a rename the cloud cannot be told about. */
  refusePatches = false;
  /** Every GET of the media list: whether it wanted signed URLs, and the tag it sent. */
  readonly assetLists: Array<{ urls: boolean; ifNoneMatch?: string }> = [];
  /** How many of those were answered 304. */
  notModified = 0;
  /** Make the media list fail, the way it does when the database is down. */
  refuseAssetLists = false;
  /** Accept every request and never answer, the way a hung server does. */
  hang = false;
  /** Requests received while hanging. */
  hung = 0;
  /**
   * The account the daemon's key belongs to (what /api/v1/me answers), and the
   * account each vault belongs to (what /api/v1/vaults/:id answers — only to
   * its owner; anyone else gets a 404). Both default to one account, so every
   * vault in these tests is its key's unless a test says otherwise.
   */
  keyOwner: string | null = "owner-1";
  readonly vaultOwners = new Map<string, string>();
  vaultOwnerOf = (_id: string): string => "owner-1";
  /** Vaults the cloud no longer has: /vaults/:id answers 404 for them. */
  readonly deletedVaults = new Set<string>();
  private readonly assets = new Map<string, { sha256: string; bytes: Buffer }>();
  /** Put a file in the cloud's copy of this vault's media. */
  addAsset(path: string, bytes: Buffer): void {
    this.assets.set(path, { sha256: createHash("sha256").update(bytes).digest("hex"), bytes });
  }
  /** Paths the daemon successfully saved. */
  readonly patched: Array<{ id: string; path: string }> = [];
  /** Wired to the cloud stub: a deleted document stops being listed, as it does
   *  for real — without this the next reconcile would put the file straight back
   *  and the test would be asserting on the wrong thing. */
  onDelete: (id: string) => void = () => {};
  /** Wired to the cloud stub, so a saved path is what the next list reports. */
  onPatch: (id: string, path: string) => void = () => {};
  private server?: Server;
  url = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (this.hang) {
        this.hung++;
        return;
      }
      if (url.pathname === "/api/v1/me" && req.method === "GET") {
        if (this.keyOwner === null) {
          res.writeHead(500).end();
          return;
        }
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ owner_id: this.keyOwner, owner_name: "Tester", connection_id: "conn-1", provider: "claude_code" }));
        return;
      }
      const vaultInfo = /^\/api\/v1\/vaults\/([^/]+)$/.exec(url.pathname);
      if (vaultInfo && req.method === "GET") {
        const id = decodeURIComponent(vaultInfo[1]);
        const owner = this.vaultOwners.get(id) ?? this.vaultOwnerOf(id);
        // Like the real route: gone is 404, someone else's is 403.
        if (this.deletedVaults.has(id)) {
          res.writeHead(404, { "content-type": "application/json" }).end('{"error":"Vault not found"}');
          return;
        }
        if (this.keyOwner === null || owner !== this.keyOwner) {
          res.writeHead(403, { "content-type": "application/json" }).end('{"error":"You don\'t own this vault."}');
          return;
        }
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ vault: { id, name: "Test", owner_id: owner } }));
        return;
      }
      if (url.pathname === "/api/v1/assets" && req.method === "GET") {
        const urls = url.searchParams.get("urls") !== "0";
        const sent = req.headers["if-none-match"];
        const ifNoneMatch = typeof sent === "string" ? sent : undefined;
        this.assetLists.push({ urls, ifNoneMatch });
        if (this.refuseAssetLists) {
          res.writeHead(500).end();
          return;
        }
        // Like the real route: the tag covers the list AND whether it carries URLs.
        const etag = `"${[...this.assets].map(([p, a]) => `${p}:${a.sha256}`).join(",")}|${urls ? 1 : 0}"`;
        if (ifNoneMatch === etag) {
          this.notModified++;
          res.writeHead(304, { etag }).end();
          return;
        }
        const assets = [...this.assets].map(([path, a]) => ({
          path,
          sha256: a.sha256,
          url: urls ? `${this.url}/blob/${a.sha256}` : null,
        }));
        res.writeHead(200, { "content-type": "application/json", etag }).end(JSON.stringify({ assets }));
        return;
      }
      const blob = /^\/blob\/([0-9a-f]+)$/.exec(url.pathname);
      if (blob && req.method === "GET") {
        const hit = [...this.assets.values()].find((a) => a.sha256 === blob[1]);
        if (!hit) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/octet-stream" }).end(hit.bytes);
        return;
      }
      if (url.pathname === "/api/v1/assets" && req.method === "POST") {
        // The daemon sends multipart; the `path` field is all this test needs.
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const m = /name="path"\r?\n\r?\n([^\r\n]+)/.exec(body);
          if (m) this.uploaded.push(m[1]);
          res.writeHead(200, { "content-type": "application/json" }).end("{}");
        });
        return;
      }
      const doc = /^\/api\/v1\/docs\/([^/]+)$/.exec(url.pathname);
      if (doc && req.method === "PATCH") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          if (this.refusePatches) {
            res.writeHead(500).end();
            return;
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as {
            path?: string;
          };
          const id = decodeURIComponent(doc[1]);
          if (body.path) {
            this.patched.push({ id, path: body.path });
            this.onPatch(id, body.path);
          }
          res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        });
        return;
      }
      if (doc && req.method === "DELETE") {
        if (this.refuseDeletes) {
          res.writeHead(500).end();
          return;
        }
        const id = decodeURIComponent(doc[1]);
        this.deleted.push(id);
        this.onDelete(id);
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        return;
      }
      res.writeHead(404).end();
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
const locks: string[] = [];
const apps: FakeAppServer[] = [];
const vaultIds: string[] = [];

/** Where the machine-wide sync lock for a vault lives. */
const lockFile = (vaultId: string): string =>
  join(locksDir(), `${vaultId}.json`);

/**
 * The per-vault merge base NodeVaultBaseStore keeps outside the vault folder.
 *
 * Keyed by vault id, so every test run left a file behind in the user's real
 * config directory — nine of them had accumulated. A test that writes to $HOME
 * has to clean $HOME.
 */
const baseStateFiles = (vaultId: string): string[] => {
  const dir = baseStoreDir();
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith(vaultId))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
};

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  // Unconditionally, because a test that plants a rival holder and then fails
  // would otherwise leave the lock behind and take the NEXT run's vault with it.
  for (const l of locks.splice(0)) rmSync(l, { force: true });
  for (const a of apps.splice(0)) a.close();
  for (const id of vaultIds.splice(0)) {
    for (const f of baseStateFiles(id)) rmSync(f, { force: true });
  }
});

let vaultSeq = 0;

/** A fresh vault: its own folder, its own id, its own fake cloud and watcher. */
async function vault(): Promise<{
  dir: string;
  vaultId: string;
  cloud: FakeCloud & { uploaded: string[] };
  watcher: TestWatcher;
  start: () => Promise<void>;
  read: (p: string) => string | null;
  touch: (p: string, content: string) => void;
  /** Delete a file the way Finder does, and tell the watcher. */
  remove: (p: string) => void;
  /** How many times the daemon reported this vault's document set changing. */
  docsChanged: () => number;
  app: FakeAppServer;
}> {
  const dir = mkdtempSync(join(tmpdir(), "vault-scenario-"));
  dirs.push(dir);
  const app = new FakeAppServer();
  await app.start();
  apps.push(app);
  const cloud = new FakeCloud() as FakeCloud & { uploaded: string[] };
  app.onDelete = (id) => cloud.deleteById(id);
  app.onPatch = (id, path) => cloud.setPath(id, path);
  // Media uploads go over HTTP, not through the store seam — read them off the
  // server that received them.
  Object.defineProperty(cloud, "uploaded", { get: () => app.uploaded });
  const watcher = new TestWatcher();
  let docsChangedCount = 0;
  // A distinct id per test: the sync lock is keyed by vault, and the vault index
  // is written under it.
  const vaultId = `00000000-0000-4000-8000-${String(++vaultSeq).padStart(12, "0")}`;
  locks.push(lockFile(vaultId));
  vaultIds.push(vaultId);

  return {
    dir,
    vaultId,
    cloud,
    app,
    watcher,
    /** Delete a file the way Finder does, and tell the watcher. */
    remove: (p: string) => {
      unlinkSync(join(dir, p));
      watcher.emit("unlink", join(dir, p));
    },
    docsChanged: () => docsChangedCount,
    start: async () => {
      const stop = await startVaultSync({
        dir,
        vaultId,
        appUrl: app.url,
        apiKey: "test-key",
        lockOwner: "test",
        reconcileMs: 100, // poll fast, so a test doesn't wait the real 15 seconds
        store: cloud.store,
        pubsub: new FakeBus(),
        listDocs: cloud.list,
        adopt: cloud.adopt,
        watch: () => watcher,
        onDocsChanged: () => {
          docsChangedCount++;
        },
        log: () => {},
      });
      stops.push(stop);
    },
    read: (p: string) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8") : null),
    touch: (p: string, content: string) => {
      writeFileSync(join(dir, p), content);
      watcher.emit(existsSync(join(dir, p)) ? "add" : "change", join(dir, p));
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

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 500));

describe("scenario 1 — a file created locally becomes a document in the cloud", () => {
  it("adopts it, exactly once", async () => {
    const v = await vault();
    await v.start();

    v.touch("notes.md", "# Notes\n\nwritten in Obsidian\n");

    await waitFor(() => v.cloud.adopted.length > 0);
    expect(v.cloud.adopted).toEqual(["notes.md"]);

    // The reconcile now sees a document it has no file for and materializes it.
    // That write must not be read as new material — this is the loop that turned
    // one document into four.
    await settle();
    expect(v.cloud.adopted).toEqual(["notes.md"]);
    expect(v.cloud.docs).toHaveLength(1);
  });

  it("pushes later edits to the same document rather than making another", async () => {
    const v = await vault();
    v.cloud.createViaApi("Journal.md", "# Journal\n");
    await v.start();
    await waitFor(() => v.read("Journal.md") !== null);
    const before = v.cloud.docs.length;

    v.touch("Journal.md", "# Journal\n\nedited on disk\n");

    await waitFor(() => {
      const snap = v.cloud.store.blobs.get(v.cloud.docs[0].id);
      if (!snap) return false;
      const doc = new Y.Doc();
      Y.applyUpdate(doc, snap);
      return doc.getText("source").toString().includes("edited on disk");
    });
    expect(v.cloud.docs).toHaveLength(before);
    expect(v.cloud.adopted).toEqual([]);
  });
});

describe("scenario 2 — a file deleted locally", () => {
  it("deletes its document, and the file stays gone", async () => {
    const v = await vault();
    const id = v.cloud.createViaApi("Kept.md", "# Kept\n");
    await v.start();
    await waitFor(() => v.read("Kept.md") !== null);

    rmSync(join(v.dir, "Kept.md"));
    v.watcher.emit("unlink", join(v.dir, "Kept.md"));

    // The flip this test was written to record. A missing file used to be
    // treated as an accident and put back, which made deletion impossible from
    // anywhere but the app — and did it in silence. The folder is the vault now,
    // as it is in Obsidian, and the three guards the old comment asked for are
    // in place: the rename window, the vault-root check, and the burst breaker.
    await waitFor(() => v.app.deleted.includes(id));
    expect(v.cloud.docs).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 400)); // a reconcile poll or two
    expect(v.read("Kept.md")).toBeNull();
  });

  it("treats a delete followed by an add as a rename, not a new document", async () => {
    const v = await vault();
    v.cloud.createViaApi("Old name.md", "# A document\n\nbody\n");
    await v.start();
    await waitFor(() => v.read("Old name.md") !== null);
    const body = v.read("Old name.md") as string;

    // What Finder does: the file appears at its new name, the old one vanishes.
    rmSync(join(v.dir, "Old name.md"));
    v.watcher.emit("unlink", join(v.dir, "Old name.md"));
    writeFileSync(join(v.dir, "New name.md"), body);
    v.watcher.emit("add", join(v.dir, "New name.md"));

    await settle();
    expect(v.cloud.adopted).toEqual([]); // never a second document
    expect(v.cloud.docs).toHaveLength(1);
  });
});

describe("scenario 2b — a renamed file is the same document, whatever else changed", () => {
  // The unlink/add pairing used to need identical bytes, and a rename made with
  // the daemon stopped had no events at all. Both cases forked the document:
  // the old name came back from the cloud and the new one was adopted as a
  // second document. The inode survives a rename; the daemon now keeps it.

  /** What the cloud's snapshot of the document at `path` says. */
  function cloudMarkdown(v: Awaited<ReturnType<typeof vault>>, path: string): string {
    const id = v.cloud.docs.find((d) => d.path === path)?.id;
    const blob = id ? v.cloud.store.blobs.get(id) : undefined;
    if (!blob) return "";
    const doc = new Y.Doc();
    Y.applyUpdate(doc, blob);
    return getMarkdown(doc);
  }

  it("pairs a rename by inode even when the file was edited on the way", async () => {
    const v = await vault();
    v.cloud.createViaApi("Old name.md", "# A document\n\nbody\n");
    await v.start();
    await waitFor(() => v.read("Old name.md") !== null);

    // An editor's save-as: new name and new bytes at once. Content matching
    // cannot pair these; the inode can.
    renameSync(join(v.dir, "Old name.md"), join(v.dir, "New name.md"));
    writeFileSync(join(v.dir, "New name.md"), "# A document\n\nbody, edited on the way\n");
    v.watcher.emit("unlink", join(v.dir, "Old name.md"));
    v.watcher.emit("add", join(v.dir, "New name.md"));

    await waitFor(() => cloudMarkdown(v, "New name.md").includes("edited on the way"));
    expect(v.cloud.adopted).toEqual([]); // never a second document
    expect(v.cloud.docs).toHaveLength(1);
    expect(v.read("Old name.md")).toBeNull(); // not written back
  });

  it("recognises a rename made while the daemon was stopped", async () => {
    const v = await vault();
    v.cloud.createViaApi("Old name.md", "# A document\n\nbody\n");
    await v.start();
    await waitFor(() => v.read("Old name.md") !== null);
    await stops.pop()?.();

    renameSync(join(v.dir, "Old name.md"), join(v.dir, "New name.md"));
    await v.start();
    await settle();

    expect(v.cloud.adopted).toEqual([]);
    expect(v.cloud.docs).toHaveLength(1);
    expect(v.cloud.docs[0].path).toBe("New name.md");
    expect(v.read("Old name.md")).toBeNull(); // the old name did not come back
    expect(v.read("New name.md")).toContain("body");
  });
});

describe("scenario 3 — a document created in the cloud arrives locally, and stops there", () => {
  it("writes the file with its content, and does not adopt it back", async () => {
    const v = await vault();
    await v.start();

    // Created through the API while the daemon is running.
    v.cloud.createViaApi("From the API.md", "# From the API\n\nmade on the web\n");

    await waitFor(() => v.read("From the API.md") !== null);
    expect(v.read("From the API.md")).toContain("made on the web");

    // The daemon wrote that file, and its own watcher sees the write. Creating a
    // document for it would invent a second document for content the cloud
    // already has.
    v.watcher.emit("add", join(v.dir, "From the API.md"));
    await settle();
    expect(v.cloud.adopted).toEqual([]);
    expect(v.cloud.docs.filter((d) => d.path === "From the API.md")).toHaveLength(1);
  });

  it("does not adopt a materialized file after a restart either", async () => {
    const v = await vault();
    v.cloud.createViaApi("Survivor.md", "# Survivor\n");
    await v.start();
    await waitFor(() => v.read("Survivor.md") !== null);
    await stops.pop()?.();

    // Second run: the file is already on disk before the watcher exists, so it is
    // the STARTUP sweep that sees it — the call site whose missing guards used to
    // adopt every materialized file afresh on every restart.
    await v.start();
    await settle();
    expect(v.cloud.adopted).toEqual([]);
    expect(v.cloud.docs).toHaveLength(1);
  });
});

// A vault uploads the media its documents ASK for, and nothing else.
//
// Everything in the folder used to go up: one source repo meant 3,179 files and
// 791 MB, of which 21 were referenced by any document. "Has an image extension"
// is not "a picture attached to a note".
describe("reference-only media", () => {
  it("uploads the image a document references, and ignores the one beside it", async () => {
    const v = await vault();
    await v.start();

    mkdirSync(join(v.dir, "assets"), { recursive: true });
    writeFileSync(join(v.dir, "assets", "wanted.png"), "referenced bytes");
    writeFileSync(join(v.dir, "assets", "stray.png"), "nobody asks for this");
    // The note that names one of them.
    writeFileSync(join(v.dir, "note.md"), "# Note\n\n![d](assets/wanted.png)\n");
    v.watcher.emit("add", join(v.dir, "note.md"));

    await waitFor(() => v.cloud.adopted.length > 0);
    await settle();

    expect(v.cloud.adopted).toEqual(["note.md"]); // images are never documents
    expect(v.cloud.uploaded).toContain("assets/wanted.png");
    expect(v.cloud.uploaded).not.toContain("assets/stray.png");
  });

  it("uploads an image that an EDIT newly references", async () => {
    const v = await vault();
    await v.start();

    mkdirSync(join(v.dir, "assets"), { recursive: true });
    writeFileSync(join(v.dir, "assets", "later.png"), "bytes");
    writeFileSync(join(v.dir, "note.md"), "# Note\n\nno pictures yet\n");
    v.watcher.emit("add", join(v.dir, "note.md"));
    await waitFor(() => v.cloud.adopted.length > 0);
    await settle();
    expect(v.cloud.uploaded).not.toContain("assets/later.png");

    // Trigger B: the image did not change — only the document did. Without a
    // trigger on document writes this would wait for the reconcile timer.
    writeFileSync(join(v.dir, "note.md"), "# Note\n\n![now](assets/later.png)\n");
    v.watcher.emit("change", join(v.dir, "note.md"));

    await waitFor(() => v.cloud.uploaded.includes("assets/later.png"), 6000);
    expect(v.cloud.uploaded).toContain("assets/later.png");
  });
});

describe("losing the vault lock mid-run", () => {
  it("stops syncing when another process takes the vault", async () => {
    const v = await vault();
    v.cloud.createViaApi("Before.md", "# Before\n");
    await v.start();
    await waitFor(() => v.read("Before.md") !== null);

    // The desktop app takes the vault from us: alive (pid 1 always is) and ticking.
    const lock = lockFile(v.vaultId);
    writeFileSync(
      lock,
      JSON.stringify({ owner: "desktop app", pid: 1, heartbeat: Date.now(), since: Date.now() })
    );

    // Anything the cloud says from here is the new holder's business, not ours.
    v.cloud.createViaApi("After.md", "# After\n");
    await settle();
    expect(v.read("After.md")).toBeNull();

    // And we left the winner's record alone.
    expect(JSON.parse(readFileSync(lock, "utf8")).owner).toBe("desktop app");
  });
});

describe("scenario 3b — a document renamed in the cloud is renamed on disk, in place", () => {
  it("moves the file without leaving a copy in .trash", async () => {
    const v = await vault();
    const id = v.cloud.createViaApi("Old title.md", "# Old title\n\nbody\n");
    await v.start();
    await waitFor(() => v.read("Old title.md") !== null);

    // The title changed on the web; the path followed it.
    v.cloud.setPath(id, "New title.md");

    await waitFor(() => v.read("New title.md") !== null);
    expect(v.read("Old title.md")).toBeNull();
    expect(v.read("New title.md")).toContain("body");
    expect(existsSync(join(v.dir, ".trash", "Old title.md"))).toBe(false);
    expect(v.cloud.adopted).toEqual([]); // the renamed file is not a new document
  });
});

describe("scenario 4 — a document deleted in the cloud leaves the folder", () => {
  it("moves the file to .trash rather than destroying it", async () => {
    const v = await vault();
    v.cloud.createViaApi("Doomed.md", "# Doomed\n");
    await v.start();
    await waitFor(() => v.read("Doomed.md") !== null);

    v.cloud.deleteInCloud("Doomed.md");

    await waitFor(() => v.read("Doomed.md") === null);
    // Trashed, never hard-deleted: the content is still the user's.
    expect(existsSync(join(v.dir, ".trash"))).toBe(true);
  });

  it("keeps every file when the cloud is unreachable", async () => {
    const v = await vault();
    v.cloud.createViaApi("Precious.md", "# Precious\n");
    await v.start();
    await waitFor(() => v.read("Precious.md") !== null);

    // A failed fetch is not "the cloud has nothing". Reading it as such would
    // retire every file in the vault.
    v.cloud.list = async () => {
      throw new Error("network is down");
    };

    await settle();
    expect(v.read("Precious.md")).toContain("Precious");
  });

  // Polling a failing server at full rate is what kept the database down on
  // 2026-09-13: every vault asked every 15 s, for nine hours.
  it("asks a failing cloud less and less often, and comes back when it returns", async () => {
    const v = await vault();
    await v.start();
    await waitFor(() => v.app.assetLists.length > 0);

    const list = v.cloud.list;
    v.cloud.list = async () => {
      throw new Error("network is down");
    };
    v.app.refuseAssetLists = true;
    const before = v.app.assetLists.length;
    await waitMs(1_500);
    // At the fixed 100 ms rate that is ~15 passes. Doubling from 100 ms, about four.
    expect(v.app.assetLists.length - before).toBeLessThan(8);

    v.cloud.list = list;
    v.app.refuseAssetLists = false;
    const failing = v.app.assetLists.length;
    await waitFor(() => v.app.assetLists.length > failing);
  });

  // A server that accepts and never answers used to hold a pass open forever, so
  // the loop never saw a failure and never tried again.
  it("gives up on a server that never answers, and keeps trying", async () => {
    process.env.MARKBASE_REQUEST_TIMEOUT_MS = "200";
    try {
      const v = await vault();
      await v.start();
      await waitFor(() => v.app.assetLists.length > 0);

      v.app.hang = true;
      await waitFor(() => v.app.hung >= 3); // each hung request was abandoned, and retried

      v.app.hang = false;
      const recovered = v.app.assetLists.length;
      await waitFor(() => v.app.assetLists.length > recovered);
    } finally {
      delete process.env.MARKBASE_REQUEST_TIMEOUT_MS;
    }
  });
});

const waitMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Listing a vault's media used to sign a download URL for every asset on every
// pass — the same 40 images ~450 times an hour each on 2026-09-13. The list is
// for diffing; a URL is only needed for a file the folder is missing.
describe("scenario 7b — media is listed cheaply", () => {
  it("lists without signed URLs, and revalidates instead of refetching", async () => {
    const v = await vault();
    await v.start();
    await waitFor(() => v.app.notModified > 0);
    expect(v.app.assetLists.every((l) => !l.urls)).toBe(true);
  });

  it("asks for URLs only to fetch a file the folder is missing", async () => {
    const v = await vault();
    v.app.addAsset("assets/pic.png", Buffer.from("not really a png"));
    await v.start();
    await waitFor(() => v.read("assets/pic.png") === "not really a png");
    const signedAfterFetch = v.app.assetLists.filter((l) => l.urls).length;
    expect(signedAfterFetch).toBeGreaterThan(0);

    // Once the folder has it, nothing asks for a URL again.
    await waitMs(500);
    expect(v.app.assetLists.filter((l) => l.urls).length).toBe(signedAfterFetch);
  });
});

// The folder is the vault, and the cloud is where it syncs to. Starting while the
// cloud was unreachable used to throw: the desktop app said "Couldn't sync", and
// nothing watched the files until a relaunch.
describe("scenario 10 — starting while the cloud is unreachable", () => {
  type Vault = Awaited<ReturnType<typeof vault>>;

  /** Put the cloud's seams behind a switch. Before start(), which captures them. */
  function goOffline(v: Vault): { reconnect: () => void } {
    let offline = true;
    const list = v.cloud.list;
    const adopt = v.cloud.adopt;
    v.cloud.list = async (withContent) => {
      if (offline) throw new Error("network is down");
      return list(withContent);
    };
    v.cloud.adopt = async (path, content) => {
      if (offline) throw new Error("network is down");
      return adopt(path, content);
    };
    return {
      reconnect: () => {
        offline = false;
      },
    };
  }

  /** A vault that synced once and stopped — so it has an index on disk. */
  async function syncedOnce(): Promise<Vault> {
    const v = await vault();
    v.cloud.createViaApi("Kept.md", "# Kept\n");
    await v.start();
    await waitFor(() => v.read("Kept.md") !== null);
    await stops.pop()?.();
    return v;
  }

  /** What the cloud's snapshot of `path` says. */
  function cloudMarkdown(v: Vault, path: string): string {
    const id = v.cloud.docs.find((d) => d.path === path)?.id;
    const blob = id ? v.cloud.store.blobs.get(id) : undefined;
    if (!blob) return "";
    const doc = new Y.Doc();
    Y.applyUpdate(doc, blob);
    return getMarkdown(doc);
  }

  it("starts from the last known index, and keeps every file", async () => {
    const v = await syncedOnce();
    goOffline(v);
    await v.start();
    await settle();
    expect(v.read("Kept.md")).toContain("Kept");
    // The index says it is a document already — not a new file to create.
    expect(v.cloud.adoptCalls).toEqual([]);
  });

  it("still needs the cloud for a vault that has never synced here", async () => {
    const v = await vault();
    goOffline(v);
    // No index: nothing tells a new file from an existing document.
    await expect(v.start()).rejects.toThrow("network is down");
  });

  it("brings an edit made offline to the cloud once it is reachable", async () => {
    const v = await syncedOnce();
    const net = goOffline(v);
    await v.start();
    v.touch("Kept.md", "# Kept\n\nwritten offline\n");
    net.reconnect();
    await waitFor(() => cloudMarkdown(v, "Kept.md").includes("written offline"));
  });

  it("turns a file made offline into a document once the cloud is back", async () => {
    const v = await syncedOnce();
    const net = goOffline(v);
    await v.start();
    v.touch("New.md", "# New\n");
    net.reconnect();
    await waitFor(() => v.cloud.adopted.includes("New.md"));
    expect(v.cloud.adopted).toEqual(["New.md"]);
  });
});

// The host that runs the daemon is usually the one showing the document list, and
// it knows the moment a file becomes a document. Without this it learned by
// refetching on window focus, throttled to once a minute — so a folder an agent
// wrote appeared minutes later, or not until you clicked away and back.
describe("scenario 8 — the host is told when the document set changes", () => {
  it("reports an adopted file", async () => {
    const v = await vault();
    await v.start();
    expect(v.docsChanged()).toBe(0);

    v.touch("note.md", "# Note\n");
    await waitFor(() => v.cloud.docs.length === 1);
    await settle();

    expect(v.docsChanged()).toBe(1);
  });

  it("reports a file renamed on disk, because the tree changes shape too", async () => {
    const v = await vault();
    await v.start();
    v.touch("before.md", "# Same content\n");
    await waitFor(() => v.cloud.docs.length === 1);
    await settle();
    const afterAdopt = v.docsChanged();

    // A rename on disk: the removal is held briefly, then paired with the add.
    unlinkSync(join(v.dir, "before.md"));
    v.watcher.emit("unlink", join(v.dir, "before.md"));
    v.touch("after.md", "# Same content\n");
    await waitFor(() => v.docsChanged() > afterAdopt);

    expect(v.docsChanged()).toBeGreaterThan(afterAdopt);
    expect(v.cloud.docs.length).toBe(1); // moved, not adopted again
  });

  it("stays quiet when nothing about the set changed", async () => {
    const v = await vault();
    await v.start();
    v.touch("note.md", "# Note\n");
    await waitFor(() => v.cloud.docs.length === 1);
    await settle();
    const afterAdopt = v.docsChanged();

    // Editing a tracked file is content, not a set change — the CRDT carries it.
    v.touch("note.md", "# Note\n\nmore words\n");
    await settle();

    expect(v.docsChanged()).toBe(afterAdopt);
  });
});

// The rules file is the one file in a vault we WANT edited, so an edit has to
// take effect without restarting the daemon — and relaxing a rule has to bring
// in what it revealed. Nothing announces those files: the watcher reports what
// changes, and nothing about them did.
describe("scenario 9 — editing .markbaseignore takes effect", () => {
  it("adopts what a removed pattern reveals", async () => {
    const v = await vault();
    // A folder the defaults hide, holding a real note.
    mkdirSync(join(v.dir, "dist"), { recursive: true });
    writeFileSync(join(v.dir, "dist/notes.md"), "# hidden by the rules\n");
    await v.start();
    await settle();
    expect(v.cloud.docs.length).toBe(0); // the default rules hide it

    // The user decides dist/ is theirs after all.
    writeFileSync(join(v.dir, ".markbaseignore"), "node_modules/\n");
    v.watcher.emit("change", join(v.dir, ".markbaseignore"));
    await waitFor(() => v.cloud.docs.length === 1);

    expect(v.cloud.docs.length).toBe(1);
  });

  it("stops adopting once a pattern is added", async () => {
    const v = await vault();
    await v.start();
    v.touch("keep.md", "# keep\n");
    await waitFor(() => v.cloud.docs.length === 1);

    writeFileSync(join(v.dir, ".markbaseignore"), "drafts/\n");
    v.watcher.emit("change", join(v.dir, ".markbaseignore"));
    await settle();

    mkdirSync(join(v.dir, "drafts"), { recursive: true });
    v.touch("drafts/wip.md", "# work in progress\n");
    await settle();
    expect(v.cloud.docs.length).toBe(1); // still just keep.md
  });
});

// Deleting a file deletes the document — the folder is the vault, the way it is
// in Obsidian. It used to restore the file instead, which made deletion
// impossible from anywhere but the app and did it without a word: `rm` reported
// success, the file came back, and today that was read as sync "resurrecting"
// files at random. It was not random, and it is not the behaviour we want.
describe("deleting a file", () => {
  it("deletes its document, and the file stays gone", async () => {
    const v = await vault();
    const id = v.cloud.createViaApi("note.md", "# Note\n\nbody\n");
    await v.start();
    await waitFor(() => v.read("note.md") !== null);

    v.remove("note.md");

    await waitFor(() => v.app.deleted.includes(id));
    // Long enough for the reconcile poll (100ms here) to have run and put it back
    // if it were going to.
    await new Promise((r) => setTimeout(r, 400));
    expect(v.read("note.md")).toBeNull();
  });

  it("puts the file back when the deletion can't be recorded", async () => {
    const v = await vault();
    v.cloud.createViaApi("note.md", "# Note\n\nbody\n");
    await v.start();
    await waitFor(() => v.read("note.md") !== null);
    v.app.refuseDeletes = true;

    v.remove("note.md");

    // Restored, because the document still exists: leaving it deleted locally
    // would be a lie the next reconcile would silently undo anyway.
    await waitFor(() => v.read("note.md") !== null);
    expect(v.app.deleted).toEqual([]);
  });

  it("leaves a rename alone — that is a move, not a deletion", async () => {
    const v = await vault();
    v.cloud.createViaApi("note.md", "# Note\n\nbody\n");
    await v.start();
    await waitFor(() => v.read("note.md") !== null);
    const body = v.read("note.md") ?? "";

    // What a rename looks like from the outside: the old path unlinks and the
    // same content appears at a new one, inside the window that pairs them.
    v.remove("note.md");
    v.touch("renamed.md", body);

    await new Promise((r) => setTimeout(r, 500));
    // Nothing was deleted: the pair was recognised as a move. Which NAME it
    // settles on is not this test's business — the stub app has no PATCH, so the
    // path never persists and reconcile pulls it back to the cloud's spelling.
    expect(v.app.deleted).toEqual([]);
    expect(v.cloud.docs).toHaveLength(1);
  });
});

// Deleting a lot is still deleting. There was a breaker here that put the files
// back past ten in ten seconds, on the theory that a burst is more likely to be
// a disk going away than a person meaning it. It is gone: a folder of fifty
// notes dragged to the Trash is fifty deletions, and a vault that argues with
// that is not local-first. The disk case is caught by the vault-root check
// instead, which is the honest test for it — the folder is gone, not the files.
describe("deleting many files at once", () => {
  it("deletes all of their documents", async () => {
    const v = await vault();
    for (let i = 0; i < 12; i++) v.cloud.createViaApi(`n${i}.md`, `# Note ${i}\n`);
    await v.start();
    await waitFor(() => v.read("n11.md") !== null);

    for (let i = 0; i < 12; i++) v.remove(`n${i}.md`);

    await waitFor(() => v.app.deleted.length === 12, 6000);
    await new Promise((r) => setTimeout(r, 400)); // a reconcile pass or two
    expect(v.cloud.docs).toHaveLength(0);
    expect(v.read("n0.md")).toBeNull();
    expect(v.read("n11.md")).toBeNull();
  });
});

// The vault belongs to the account that mounted it (vault-account.ts).
//
// 2026-10-30: the desktop app was signed out and into a second account on the
// same Mac. The registry is machine-wide, so every folder was mounted under the
// new key; each vault listed as empty (not that account's); every file in it
// was read as a document that had "left" and POSTed back as a new document, with
// `adopt: true` and the first account's vault_id. 116 documents. Three things
// now stand in the way, and these scenarios drive each through the real daemon:
// the account recorded on the folder, the empty listing that is not believed,
// and (on the server) the 403 — which the fake cloud here does not model, so the
// daemon has to be the one that never asks.
describe("the vault belongs to the account that mounted it", () => {
  it("records the key's account on the folder and in the registry on the first confirmed run", async () => {
    const v = await vault();
    await addMountedVault({ vaultId: v.vaultId, name: "Test", dir: v.dir });
    v.cloud.createViaApi("a.md", "# A\n");
    await v.start();
    await waitFor(() => v.read("a.md") !== null);

    expect(readVaultMarkerInfo(v.dir)).toEqual({ vaultId: v.vaultId, ownerId: "owner-1" });
    expect(readMountedVaults().find((m) => m.vaultId === v.vaultId)?.ownerId).toBe("owner-1");
  });

  it("refuses to start under a key from another account, and touches nothing", async () => {
    const v = await vault();
    v.cloud.createViaApi("a.md", "# A\n");
    v.cloud.createViaApi("b.md", "# B\n");
    await v.start();
    await waitFor(() => v.read("b.md") !== null);
    for (const stop of stops.splice(0)) await stop();
    const indexBefore = readFileSync(join(v.dir, ".markbase", "index.json"), "utf8");
    // A file made while nothing was running — the one the old daemon would
    // have uploaded into the other account's vault.
    writeFileSync(join(v.dir, "mine.md"), "# Mine\n");

    // Signed in as someone else: /me answers a different owner, and that
    // account's listing of this vault is empty.
    v.app.keyOwner = "owner-2";
    v.cloud.docs = [];

    await expect(v.start()).rejects.toBeInstanceOf(VaultNotOursError);
    await settle();
    expect(v.cloud.adoptCalls).toEqual([]);
    expect(v.read("a.md")).toContain("# A");
    expect(v.read("mine.md")).toBe("# Mine\n");
    expect(existsSync(join(v.dir, ".trash"))).toBe(false);
    expect(readFileSync(join(v.dir, ".markbase", "index.json"), "utf8")).toBe(indexBefore);
    expect(readVaultMarkerInfo(v.dir)?.ownerId).toBe("owner-1");
  });

  it("refuses a folder with no recorded account when the API says the vault is gone, and leaves its files", async () => {
    const v = await vault();
    v.cloud.createViaApi("a.md", "# A\n");
    await v.start();
    await waitFor(() => v.read("a.md") !== null);
    for (const stop of stops.splice(0)) await stop();
    writeFileSync(join(v.dir, ".markbase", "vault.json"), JSON.stringify({ vaultId: v.vaultId }));

    v.app.deletedVaults.add(v.vaultId);
    v.cloud.docs = [];

    await expect(v.start()).rejects.toThrow(/deleted in the cloud/);
    expect(v.cloud.adoptCalls).toEqual([]);
    expect(v.read("a.md")).toContain("# A");
    expect(existsSync(join(v.dir, ".trash"))).toBe(false);
  });

  it("refuses a folder with no recorded account when the API says the vault is not this key's", async () => {
    // A mount from before owners were recorded: marker and registry know the
    // vault, not whose it is. The API is asked, and a 404 is the answer.
    const v = await vault();
    v.cloud.createViaApi("a.md", "# A\n");
    await v.start();
    await waitFor(() => v.read("a.md") !== null);
    for (const stop of stops.splice(0)) await stop();
    writeFileSync(join(v.dir, ".markbase", "vault.json"), JSON.stringify({ vaultId: v.vaultId }));

    v.app.keyOwner = "owner-2";
    v.cloud.docs = [];

    await expect(v.start()).rejects.toBeInstanceOf(VaultNotOursError);
    expect(v.cloud.adoptCalls).toEqual([]);
    expect(v.read("a.md")).toContain("# A");
    expect(readVaultMarkerInfo(v.dir)).toEqual({ vaultId: v.vaultId });
  });

  it("does not adopt or retire while the account cannot be confirmed, and catches up once it is", async () => {
    const v = await vault();
    v.cloud.createViaApi("a.md", "# A\n");
    await v.start();
    await waitFor(() => v.read("a.md") !== null);
    for (const stop of stops.splice(0)) await stop();
    writeFileSync(join(v.dir, "new.md"), "# New\n");

    // /me is down; the vault is recorded for owner-1. Nothing says whose key
    // this is, so nothing is created.
    v.app.keyOwner = null;
    await v.start();
    await settle();
    expect(v.cloud.adoptCalls).toEqual([]);

    // /me is back and agrees: the deferred adoption runs.
    v.app.keyOwner = "owner-1";
    await waitFor(() => v.cloud.adoptCalls.length === 1);
    expect(v.cloud.adoptCalls[0].path).toBe("new.md");
  });

  it("stops a run whose key turns out to be another account's once /me answers", async () => {
    const v = await vault();
    v.cloud.createViaApi("a.md", "# A\n");
    await v.start();
    await waitFor(() => v.read("a.md") !== null);
    for (const stop of stops.splice(0)) await stop();
    writeFileSync(join(v.dir, "new.md"), "# New\n");

    v.app.keyOwner = null;
    await v.start();
    await settle();
    v.app.keyOwner = "owner-2";
    v.cloud.docs = [];
    await settle();
    await settle();
    expect(v.cloud.adoptCalls).toEqual([]);
    expect(v.read("a.md")).toContain("# A");
    expect(existsSync(join(v.dir, ".trash"))).toBe(false);
  });
});

describe("an empty listing for a vault that has documents is not believed", () => {
  it("refuses to start, adopts nothing and retires nothing", async () => {
    const v = await vault();
    for (const n of ["a", "b", "c"]) v.cloud.createViaApi(`${n}.md`, `# ${n}\n`);
    await v.start();
    await waitFor(() => v.read("c.md") !== null);
    for (const stop of stops.splice(0)) await stop();
    expect(readVaultIndex(v.dir)?.docs).toHaveLength(3);
    writeFileSync(join(v.dir, "extra.md"), "# Extra\n");

    // Same account, same vault — the server just says there is nothing in it.
    v.cloud.docs = [];

    await expect(v.start()).rejects.toThrow(/lists no documents/);
    expect(v.cloud.adoptCalls).toEqual([]);
    for (const n of ["a", "b", "c", "extra"]) expect(v.read(`${n}.md`)).not.toBeNull();
    expect(existsSync(join(v.dir, ".trash"))).toBe(false);
  });

  it("ignores the answer mid-run, and keeps every file", async () => {
    const v = await vault();
    for (const n of ["a", "b", "c"]) v.cloud.createViaApi(`${n}.md`, `# ${n}\n`);
    await v.start();
    await waitFor(() => v.read("c.md") !== null);

    v.cloud.docs = [];
    await settle();
    await settle();

    for (const n of ["a", "b", "c"]) expect(v.read(`${n}.md`)).not.toBeNull();
    expect(existsSync(join(v.dir, ".trash"))).toBe(false);
    expect(v.cloud.adoptCalls).toEqual([]);
  });

  it("still follows the cloud when a vault with one or two documents is emptied", async () => {
    const v = await vault();
    v.cloud.createViaApi("only.md", "# Only\n");
    await v.start();
    await waitFor(() => v.read("only.md") !== null);

    v.cloud.docs = [];
    await waitFor(() => v.read("only.md") === null);
    expect(existsSync(join(v.dir, ".trash"))).toBe(true);
  });
});
