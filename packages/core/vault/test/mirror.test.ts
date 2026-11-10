import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncMirror } from "../src/mirror";

// End-to-end over a stand-in docs API. The mirror's failure modes are all
// *silent* — a phantom push loop, a file trashed on creation, an edit lost to a
// clobber — so they need a real round trip to catch, not a mocked one.

interface Doc {
  id: string;
  title: string;
  content: string;
  version: number;
}

const ROADMAP = "aaaaaaaa-0000-4000-8000-000000000001";
const NOTES = "bbbbbbbb-0000-4000-8000-000000000002";

// The server re-renders markdown on save. If the mirror doesn't re-read that
// canonical text, the file and the document differ forever and every sweep
// pushes the same edit again.
const normalize = (s: string) => s.replace(/[ \t]+$/gm, "");

let docs: Map<string, Doc>;
let server: Server;
let port: number;
let dir: string;
let logs: string[];
let created: number;

const ctx = () => ({
  appUrl: `http://127.0.0.1:${port}`,
  apiKey: "test",
  dir,
  log: (m: string) => logs.push(m),
});

const read = (name: string) => readFileSync(join(dir, name), "utf8");
const write = (name: string, s: string) => writeFileSync(join(dir, name), s);

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = await new Promise<string>((r) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => r(b));
    });
    const json = (code: number, data: object) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const m = /^\/api\/v1\/docs\/([^/]+)(\/content)?$/.exec(url.pathname);

    if (url.pathname === "/api/v1/docs" && req.method === "GET") {
      return json(200, {
        docs: [...docs.values()].map(({ id, title, version }) => ({ id, title, version })),
      });
    }
    if (url.pathname === "/api/v1/docs" && req.method === "POST") {
      const { title, content } = JSON.parse(body) as { title: string; content: string };
      const id = `cccccccc-0000-4000-8000-00000000000${++created}`;
      docs.set(id, { id, title, content: normalize(content), version: 1 });
      return json(201, { doc: { id, title, version: 1 } });
    }
    if (m && !m[2] && req.method === "GET") {
      const d = docs.get(m[1]);
      return d ? json(200, { doc: d }) : json(404, { error: "gone" });
    }
    if (m && m[2] && req.method === "PUT") {
      const d = docs.get(m[1]);
      if (!d) return json(404, { error: "gone" });
      const { content, version } = JSON.parse(body) as { content: string; version: number };
      // The same compare-and-set the real endpoint does.
      if (version !== d.version) {
        return json(409, { error: "conflict", serverVersion: d.version });
      }
      d.content = normalize(content);
      d.version += 1;
      return json(200, { version: d.version });
    }
    return json(404, { error: "no route" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
});

afterAll(() => server.close());

beforeEach(() => {
  created = 0;
  logs = [];
  dir = mkdtempSync(join(tmpdir(), "mirror-"));
  docs = new Map([
    [ROADMAP, { id: ROADMAP, title: "Roadmap", content: "# Roadmap\n\nShip the mirror.\n", version: 3 }],
    [NOTES, { id: NOTES, title: "Notes", content: "---\ntags:\n  - x\n---\n# Notes\n\nHello.\n", version: 1 }],
  ]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("syncMirror", () => {
  it("pulls documents to disk, stamped with their id", async () => {
    await syncMirror(ctx());
    expect(existsSync(join(dir, "Roadmap.md"))).toBe(true);
    expect(read("Roadmap.md")).toContain(`markbase_id: ${ROADMAP}`);
    expect(read("Roadmap.md")).toContain("Ship the mirror.");
    // A document's own frontmatter survives the round trip.
    expect(read("Notes.md")).toContain("tags:");
  });

  it("is idempotent — a second sweep pushes nothing", async () => {
    await syncMirror(ctx());
    logs = [];
    await syncMirror(ctx());
    expect(logs.filter((l) => l.includes("pushed"))).toEqual([]);
    expect(docs.get(ROADMAP)!.version).toBe(3);
  });

  it("pushes a local edit, then doesn't push it again", async () => {
    await syncMirror(ctx());
    write("Roadmap.md", read("Roadmap.md").replace("Ship the mirror.", "Ship it today."));
    await syncMirror(ctx());

    expect(docs.get(ROADMAP)!.content).toContain("Ship it today.");
    expect(docs.get(ROADMAP)!.version).toBe(4);
    expect(read("Roadmap.md")).toContain("markbase_version: 4");

    logs = [];
    await syncMirror(ctx());
    expect(logs.filter((l) => l.includes("pushed"))).toEqual([]);
  });

  it("pulls a remote edit into the file", async () => {
    await syncMirror(ctx());
    const d = docs.get(ROADMAP)!;
    d.content = "# Roadmap\n\nChanged in the browser.\n";
    d.version = 5;
    await syncMirror(ctx());
    expect(read("Roadmap.md")).toContain("Changed in the browser.");
  });

  it("when both sides changed, keeps the local text instead of clobbering it", async () => {
    await syncMirror(ctx());
    write("Roadmap.md", read("Roadmap.md").replace("Ship the mirror.", "Local says this."));
    const d = docs.get(ROADMAP)!;
    d.content = "# Roadmap\n\nRemote says that.\n";
    d.version = 6;

    await syncMirror(ctx());

    const conflicts = readdirSync(join(dir, ".conflicts"));
    expect(conflicts).toHaveLength(1);
    expect(readFileSync(join(dir, ".conflicts", conflicts[0]), "utf8")).toContain("Local says this.");
    // The server's copy owns the real filename; nothing was lost either way.
    expect(read("Roadmap.md")).toContain("Remote says that.");
  });

  it("adopts a markdown file the user dropped in the folder", async () => {
    await syncMirror(ctx());
    write("Fresh idea.md", "# Fresh idea\n\nFrom disk.\n");
    await syncMirror(ctx());

    const fresh = [...docs.values()].find((d) => d.title === "Fresh idea");
    expect(fresh?.content).toContain("From disk.");
    expect(read("Fresh idea.md")).toContain("markbase_id: cccccccc");
    // Regression: the doc list is fetched before adoption, so the deleted-on-
    // server pass must not mistake the new id for a document that vanished.
    expect(existsSync(join(dir, ".trash", "Fresh idea.md"))).toBe(false);
  });

  it("restores a deleted file rather than deleting the document", async () => {
    await syncMirror(ctx());
    rmSync(join(dir, "Roadmap.md"));
    await syncMirror(ctx());
    // `git checkout`, a crashed editor, an rm -rf: none may destroy a document.
    expect(existsSync(join(dir, "Roadmap.md"))).toBe(true);
    expect(docs.has(ROADMAP)).toBe(true);
  });

  it("retires a server-deleted document to .trash instead of erasing it", async () => {
    await syncMirror(ctx());
    docs.delete(NOTES);
    await syncMirror(ctx());
    expect(existsSync(join(dir, "Notes.md"))).toBe(false);
    expect(existsSync(join(dir, ".trash", "Notes.md"))).toBe(true);
  });
});
