import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  assignFilenames,
  bodyHash,
  decideAction,
  readMirrorMeta,
  stripMirrorMeta,
  withMirrorMeta,
  type SyncState,
} from "./mirror-format";

// The local folder mirror: every document the user owns, as a .md file on their
// own disk, kept in sync both ways by the worker that's already running there.
//
// This is what makes agents (and ripgrep, and git) first-class readers of a
// Markbase workspace without an API call. The file is the interface.

const STATE_FILE = ".markbase-mirror.json";
const CONFLICT_DIR = ".conflicts";
const TRASH_DIR = ".trash";

interface DocSummary {
  id: string;
  title: string;
  version: number;
}

interface MirrorCtx {
  appUrl: string;
  apiKey: string;
  dir: string;
  log: (m: string) => void;
}

type StateFile = Record<string, SyncState & { path: string }>;

async function api<T>(
  ctx: MirrorCtx,
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; status: number; data: T | null }> {
  const res = await fetch(`${ctx.appUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    // some responses have no body
  }
  if (!res.ok) return { ok: false, status: res.status, data };
  return { ok: true, data: data as T };
}

async function readState(dir: string): Promise<StateFile> {
  try {
    return JSON.parse(await readFile(join(dir, STATE_FILE), "utf8")) as StateFile;
  } catch {
    return {};
  }
}

async function writeState(dir: string, state: StateFile): Promise<void> {
  await writeFile(join(dir, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
}

// Files the user could plausibly have authored. Hidden dirs (.conflicts, .trash)
// and our state file are ours, not theirs.
async function listMarkdown(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("."))
    .map((e) => e.name);
}

/** `Roadmap.md` -> `.conflicts/Roadmap 2026-07-10T06-12-01.md` */
function conflictPath(dir: string, filename: string, stamp: string): string {
  const base = filename.replace(/\.md$/, "");
  return join(dir, CONFLICT_DIR, `${base} ${stamp}.md`);
}

/**
 * One full sweep. Best-effort throughout: a mirror that fails must never take
 * the worker down with it, and must never delete a document.
 *
 * `now` is injected so the conflict-file name is deterministic under test.
 */
export async function syncMirror(
  ctx: MirrorCtx,
  now: () => Date = () => new Date()
): Promise<void> {
  await mkdir(ctx.dir, { recursive: true });

  const listed = await api<{ docs: DocSummary[] }>(ctx, "/api/v1/docs");
  if (!listed.ok) {
    ctx.log(`mirror: couldn't list documents (${listed.status})`);
    return;
  }
  const docs = listed.data.docs ?? [];
  const state = await readState(ctx.dir);
  const names = assignFilenames(docs);
  const byId = new Map(docs.map((d) => [d.id, d]));

  // Index what's on disk by the id in its frontmatter, so a file the user renamed
  // still resolves to its document.
  const files = await listMarkdown(ctx.dir);
  const onDisk = new Map<string, { name: string; raw: string }>();
  const orphans: { name: string; raw: string }[] = [];
  for (const name of files) {
    const raw = await readFile(join(ctx.dir, name), "utf8");
    const { id } = readMirrorMeta(raw);
    if (id) onDisk.set(id, { name, raw });
    else orphans.push({ name, raw });
  }

  // A .md file with no id: the user wrote it here. Adopt it as a new document.
  for (const o of orphans) {
    const title = o.name.replace(/\.md$/, "");
    const created = await api<{ doc: DocSummary }>(ctx, "/api/v1/docs", {
      method: "POST",
      body: JSON.stringify({ title, content: o.raw }),
    });
    if (!created.ok || !created.data?.doc) {
      ctx.log(`mirror: couldn't create "${o.name}" (${created.ok ? "?" : created.status})`);
      continue;
    }
    const doc = created.data.doc;
    const body = await pull(ctx, doc.id);
    if (!body) continue;
    await writeFile(join(ctx.dir, o.name), withMirrorMeta(body.content, doc.id, body.version));
    state[doc.id] = { path: o.name, version: body.version, hash: bodyHash(body.content) };
    // The doc list was fetched before this document existed. Without registering
    // it, the deleted-on-server pass below wouldn't recognize the id and would
    // trash the file we just created.
    byId.set(doc.id, { id: doc.id, title, version: body.version });
    ctx.log(`mirror: created "${title}" from ${o.name}`);
  }

  for (const doc of docs) {
    const want = names.get(doc.id) ?? `${doc.id}.md`;
    const disk = onDisk.get(doc.id);
    const st = state[doc.id];
    const fileBody = disk ? stripMirrorMeta(disk.raw) : null;

    const action = decideAction({
      state: st,
      fileExists: !!disk,
      fileHash: fileBody === null ? null : bodyHash(fileBody),
      fileHasId: !!disk,
      serverVersion: doc.version,
    });

    // Keep the user's filename if they renamed it; only name new files ourselves.
    const path = disk?.name ?? st?.path ?? want;

    try {
      switch (action.kind) {
        case "noop":
          break;

        case "restore":
          ctx.log(`mirror: ${path} is missing — restoring from the server`);
        // falls through
        case "pull": {
          const got = await pull(ctx, doc.id);
          if (!got) break;
          await writeFile(join(ctx.dir, path), withMirrorMeta(got.content, doc.id, got.version));
          state[doc.id] = { path, version: got.version, hash: bodyHash(got.content) };
          break;
        }

        case "push": {
          const pushed = await push(ctx, doc.id, fileBody ?? "", st.version);
          if (pushed === "conflict") {
            await resolveConflict(ctx, doc.id, path, fileBody ?? "", state, now);
            break;
          }
          if (pushed === null) break;
          // Re-read the canonical rendering. The server normalizes markdown, so
          // without this the file and the doc differ forever and every sweep
          // pushes the same edit again.
          const got = await pull(ctx, doc.id);
          if (!got) break;
          await writeFile(join(ctx.dir, path), withMirrorMeta(got.content, doc.id, got.version));
          state[doc.id] = { path, version: got.version, hash: bodyHash(got.content) };
          ctx.log(`mirror: pushed ${path} → v${got.version}`);
          break;
        }

        case "conflict":
          await resolveConflict(ctx, doc.id, path, fileBody ?? "", state, now);
          break;

        case "create":
          break; // handled above, before the doc loop
      }
    } catch (e) {
      ctx.log(`mirror: ${path} failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Documents deleted on the server: retire the file, never in place.
  for (const [id, entry] of Object.entries(state)) {
    if (byId.has(id)) continue;
    const from = join(ctx.dir, entry.path);
    if (existsSync(from)) {
      await mkdir(join(ctx.dir, TRASH_DIR), { recursive: true });
      await rename(from, join(ctx.dir, TRASH_DIR, entry.path)).catch(() => {});
      ctx.log(`mirror: ${entry.path} was deleted on the server — moved to ${TRASH_DIR}/`);
    }
    delete state[id];
  }

  await writeState(ctx.dir, state);
}

async function pull(
  ctx: MirrorCtx,
  docId: string
): Promise<{ content: string; version: number } | null> {
  const res = await api<{ doc: { content: string; version: number } }>(
    ctx,
    `/api/v1/docs/${docId}`
  );
  if (!res.ok || !res.data?.doc) return null;
  return { content: res.data.doc.content, version: res.data.doc.version };
}

/** null = failed, "conflict" = server moved, number = new version. */
async function push(
  ctx: MirrorCtx,
  docId: string,
  content: string,
  baseVersion: number
): Promise<number | "conflict" | null> {
  const res = await api<{ version: number }>(ctx, `/api/v1/docs/${docId}/content`, {
    method: "PUT",
    body: JSON.stringify({ content, version: baseVersion }),
  });
  if (res.ok) return res.data.version;
  if (res.status === 409) return "conflict";
  ctx.log(`mirror: push failed (${res.status})`);
  return null;
}

/**
 * Both sides changed. Rather than pick a winner, keep the user's text under
 * .conflicts/ and let the server's copy own the filename — the same bargain
 * Obsidian strikes, and the only one that can't lose work.
 */
async function resolveConflict(
  ctx: MirrorCtx,
  docId: string,
  path: string,
  localBody: string,
  state: StateFile,
  now: () => Date
): Promise<void> {
  const stamp = now().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await mkdir(join(ctx.dir, CONFLICT_DIR), { recursive: true });
  await writeFile(conflictPath(ctx.dir, path, stamp), localBody);

  const got = await pull(ctx, docId);
  if (!got) return;
  await writeFile(join(ctx.dir, path), withMirrorMeta(got.content, docId, got.version));
  state[docId] = { path, version: got.version, hash: bodyHash(got.content) };
  ctx.log(
    `mirror: ${path} changed in both places — your version is in ${CONFLICT_DIR}/, the server's is in ${path}`
  );
}

export { CONFLICT_DIR, TRASH_DIR, STATE_FILE };
