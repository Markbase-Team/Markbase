import { readdirSync, statSync, watch as fsWatch } from "node:fs";
import { join, sep } from "node:path";

// The vault's file watcher: one recursive fs.watch on the root.
//
// This replaced chokidar, which opened a separate fs.watch handle on every file
// and directory it walked — its way of seeing a write through kqueue, which
// reports changes to a directory's entries and nothing about their contents.
// On a vault over a code repository that was sixteen thousand handles: minutes
// to open, and a close that held the desktop's main thread for eleven seconds
// (Log out looked frozen, quit sat there, and no timer could fire to cut it
// short). Node's recursive watch is FSEvents on macOS and native on Windows:
// one handle for the whole tree, however large, and events for writes, adds
// and removes at any depth.
//
// What chokidar added on top — classifying an event as add, change or unlink,
// and reporting every file inside a directory that appears or disappears —
// this does itself, from the one fact fs.watch does not give: whether the
// path is there now. A stat after the event settles answers that, and a
// record of the files seen so far turns "there" into add or change and "not
// there" into unlink. An editor's atomic save (write a temp file, rename it
// over the original) is a rename event for a path that still exists, so it is
// a change, not an unlink followed by an add.
//
// Ignoring is the caller's rule, applied to every event path before anything
// else happens. fs.watch cannot be told to skip a subtree, so node_modules is
// watched and its events are dropped — the cost of events discarded rather
// than of handles held, and FSEvents coalesces bursts.

export type VaultWatchEvent = "add" | "change" | "unlink";

/** The slice of a watcher the daemon uses. Paths are ABSOLUTE. */
export interface VaultWatcher {
  on(event: VaultWatchEvent, cb: (path: string) => void): void;
  close(): Promise<void>;
}

export interface WatchVaultOptions {
  /** Vault-relative path (forward slashes) → leave it alone. The daemon's own rules. */
  ignored: (relPath: string) => boolean;
  /**
   * Files already on disk, vault-relative, so that their disappearance is an
   * unlink and their first write a change. What is not listed here reports
   * its first write as an add — harmless for the daemon, which treats the two
   * alike — and its deletion not at all.
   */
  known?: Iterable<string>;
  /** How long a path's events are coalesced before it is looked at. */
  settleMs?: number;
  log?: (message: string) => void;
}

/** Every file and directory under `rel` (vault-relative) that the rule allows. */
function walk(
  dir: string,
  rel: string,
  ignored: (relPath: string) => boolean
): { files: string[]; dirs: string[] } {
  const files: string[] = [];
  const dirs: string[] = [];
  const visit = (sub: string): void => {
    let entries;
    try {
      entries = readdirSync(join(dir, sub), { withFileTypes: true });
    } catch {
      return; // gone again already, or unreadable — the next event says more
    }
    for (const entry of entries) {
      const childRel = sub ? `${sub}/${entry.name}` : entry.name;
      if (ignored(childRel)) continue;
      if (entry.isDirectory()) {
        dirs.push(childRel);
        visit(childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  };
  visit(rel);
  return { files, dirs };
}

export function watchVault(dir: string, opts: WatchVaultOptions): VaultWatcher {
  const settleMs = opts.settleMs ?? 50;
  const log = opts.log ?? (() => {});
  const handlers = new Map<VaultWatchEvent, Array<(path: string) => void>>();
  const emit = (event: VaultWatchEvent, rel: string): void => {
    for (const cb of handlers.get(event) ?? []) cb(join(dir, rel));
  };

  // Files seen so far and directories known to exist, both vault-relative.
  const files = new Set<string>(opts.known ?? []);
  const dirs = new Set<string>(walk(dir, "", opts.ignored).dirs);

  const gone = (rel: string): void => {
    if (files.delete(rel)) {
      emit("unlink", rel);
      return;
    }
    if (!dirs.delete(rel)) return;
    // A directory went, and the files inside it with it. The OS reports the
    // directory; the daemon needs each file, the way it would have heard about
    // them one by one.
    const prefix = `${rel}/`;
    for (const d of [...dirs]) if (d.startsWith(prefix)) dirs.delete(d);
    for (const f of [...files]) {
      if (!f.startsWith(prefix)) continue;
      files.delete(f);
      emit("unlink", f);
    }
  };

  const appeared = (rel: string): void => {
    if (dirs.has(rel)) return; // a known directory: its files report themselves
    dirs.add(rel);
    // New here — created, or moved in whole. Everything inside is new too.
    const inside = walk(dir, rel, opts.ignored);
    for (const d of inside.dirs) dirs.add(d);
    for (const f of inside.files) {
      if (files.has(f)) continue;
      files.add(f);
      emit("add", f);
    }
  };

  const settle = (rel: string): void => {
    pending.delete(rel);
    if (closed) return;
    let stat;
    try {
      stat = statSync(join(dir, rel));
    } catch {
      gone(rel);
      return;
    }
    if (stat.isDirectory()) {
      appeared(rel);
    } else if (stat.isFile()) {
      const had = files.has(rel);
      files.add(rel);
      emit(had ? "change" : "add", rel);
    }
  };

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let closed = false;
  const watcher = fsWatch(dir, { recursive: true, persistent: true }, (_type, filename) => {
    if (closed || !filename) return;
    const rel = String(filename).split(sep).join("/");
    if (rel === "" || rel === "." || opts.ignored(rel)) return;
    const timer = pending.get(rel);
    if (timer) clearTimeout(timer);
    pending.set(rel, setTimeout(() => settle(rel), settleMs));
  });
  watcher.on("error", (e) => log(`watcher error: ${e.message}`));

  return {
    on(event, cb) {
      const list = handlers.get(event) ?? [];
      list.push(cb);
      handlers.set(event, list);
    },
    async close() {
      closed = true;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      handlers.clear();
      watcher.close();
    },
  };
}
