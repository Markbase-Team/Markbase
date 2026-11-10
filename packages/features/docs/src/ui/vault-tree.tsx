"use client";

import { api } from "@markbase/protocol/api-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { readLocalJson, removeLocal, writeLocalJson } from "./local-store";
import { usePrompt } from "@markbase/ui/prompt-dialog";
import { useNavigation } from "@markbase/ui/navigation";
import { cn } from "@markbase/ui/utils";
import { LocalDate } from "./local-date";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { buildFolderTree, filePathIn, filesUnder, moveFolder, renameFolder, type FolderNode, type Move } from "@markbase/protocol/folders";
import { nextPollDelay } from "@markbase/protocol/poll-backoff";
import { intentFromClick, type OpenIntent } from "@markbase/docs/workspace-tabs";
import { isSharedScope, SHARED_SCOPE } from "./scope";
import { readLocalVaultDocs, type VaultIndexEntry } from "./vault-index-client";
import { useDocsPorts, type VaultsPort } from "./ports";
import { useMountedVaults } from "./use-mounted-vaults";
import { FolderSync } from "lucide-react";
import {
  fetchDocList,
  invalidateDocLists,
  peekDocList,
  subscribeDocLists,
} from "./doc-list-fetch";

export type DocMeta = {
  id: string;
  title: string;
  /** Vault-relative path; null on docs created before paths existed. */
  path: string | null;
  version: number;
  updated_at: string;
};

/** What's being dragged: a single document, or a whole folder subtree. */
type Drag = { kind: "doc" | "folder"; path: string };

/** Where a doc sits in the tree. Mirrors the vault's fallback exactly: a doc with
 *  no path yet shows at the root under its title — where the vault also puts it. */
function pathOf(d: DocMeta): string {
  if (d.path) return d.path;
  const base = (d.title || "Untitled").replace(/[/\\:*?"<>|]+/g, "-").trim() || "Untitled";
  return `${base}.md`;
}

/**
 * The folder/doc tree for one vault (or every doc you can see when `vaultId` is
 * null). Owns loading, create, delete, rename, and drag-and-drop move — the same
 * folder engine the vault daemon uses, so the web tree and the folders on disk
 * are always the same shape.
 *
 * How a doc opens is the caller's call: the page navigates to it, the sidebar
 * opens it as a tab. That's `onOpenDoc`.
 */
/**
 * The folders you have shut, per vault, kept on this device.
 *
 * Per vault because the arrangement is about that vault's shape; per device
 * because it is a view preference, not something to sync. Reading is defensive:
 * a key someone hand-edited, or written by an older shape of this code, must
 * leave the tree fully expanded rather than throw during render.
 */
const COLLAPSED_KEY = "mb:collapsedFolders";

function collapsedKey(vaultId: string | null): string {
  return `${COLLAPSED_KEY}:${vaultId ?? "all"}`;
}

function readCollapsed(vaultId: string | null): Set<string> {
  // Checked, not cast: this is whatever was in storage last, possibly written by
  // an older build.
  const paths = readLocalJson(collapsedKey(vaultId));
  if (!Array.isArray(paths)) return new Set();
  return new Set(paths.filter((p): p is string => typeof p === "string"));
}

function writeCollapsed(vaultId: string | null, collapsed: Set<string>): void {
  const key = collapsedKey(vaultId);
  // Nothing shut is the default, so store nothing rather than an empty array.
  if (collapsed.size === 0) removeLocal(key);
  else writeLocalJson(key, [...collapsed]);
}

/** Every folder path in the tree, root excluded (it is not a row). */
function allFolderPaths(node: FolderNode): string[] {
  return node.folders.flatMap((f) => [f.path, ...allFolderPaths(f)]);
}

/** First retry after the list request fails; later ones back off from here. */
const LIST_RETRY_MS = 5_000;

export function VaultTree({
  vaultId,
  onOpenDoc,
  variant = "page",
  reloadKey = 0,
  awaitingScope = false,
  syncing = null,
}: {
  vaultId: string | null;
  /** Open a document — in the current tab, or a new one (⌘/Ctrl or middle click). */
  onOpenDoc: (docId: string, title: string | undefined, intent: OpenIntent) => void;
  variant?: "page" | "sidebar";
  /** Change this to re-fetch the doc list in place (keeps folders expanded) — the
   *  shell bumps it when the vault's docs change, including daemon-synced files. */
  reloadKey?: number;
  /** The caller hasn't resolved which vault to show yet. Holds the fetch instead
   *  of reading `vaultId: null` as "every vault": the sidebar mounts before
   *  /api/v1/vaults answers, and the unscoped list is a whole extra round trip
   *  whose result is thrown away a moment later when the real vault arrives. */
  awaitingScope?: boolean;
  /** The vault's first sync, while it runs — shown under the tree. */
  syncing?: { done: number; total: number } | null;
}) {
  const { push, refresh } = useNavigation();
  const dense = variant === "sidebar";
  // "Shared with me" is read-only: those docs live in someone else's vault, so
  // there's nothing here to create, move, rename, or (for docs you don't own)
  // delete.
  const readOnly = isSharedScope(vaultId);
  // Shared-with-me, a single vault, or everything when none is chosen.
  const url = isSharedScope(vaultId)
    ? "/api/v1/docs?scope=shared"
    : vaultId
      ? `/api/v1/docs?vault=${encodeURIComponent(vaultId)}`
      : "/api/v1/docs";
  // Seed straight from the app-lifetime cache: a list we've already loaded
  // renders immediately, with no spinner and no request, however many times this
  // tree is mounted and unmounted.
  const cached = peekDocList<{ docs?: DocMeta[] }>(url);
  const ask = usePrompt();
  const [docs, setDocs] = useState<DocMeta[]>(cached?.docs ?? []);
  const [loading, setLoading] = useState(!cached);
  // The list could not be read. Distinct from "the vault is empty", which is what
  // a failed load used to look like — the most misleading thing this tree can say.
  const [loadError, setLoadError] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Bumped by "Try again" — the caller's reloadKey is for data changes, not retries.
  const [reloadNonce, setReloadNonce] = useState(0);
  // Which folders are shut. Remembered per vault, because a tree you have tidied
  // is a layout you chose: it was rebuilt from scratch on every mount, so every
  // navigation threw the arrangement away and reopened everything.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(vaultId));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Local first, network second.
   *
   * A vault mounted here IS these documents — they are files, and the daemon
   * keeps an index beside the folder saying which document each file is. Reading
   * that is a disk read, so it is what the tree paints from; the request that
   * follows corrects and completes it. The network still knows things the disk
   * cannot (a vault not mounted on this machine, "Shared with me", a document
   * made elsewhere and not yet synced down), which is why it is asked at all —
   * but it is no longer what the tree WAITS for.
   *
   * The order matters beyond speed. When the fetch failed, the tree had nothing
   * to fall back on and said "Nothing in this vault yet" — the one sentence that
   * makes a working vault look destroyed.
   */
  const loadedOnceRef = useRef(!!cached);
  // Which list's network answer is on screen. Until it's this `url`, what's shown
  // is the disk index a failed request fell back to, and the retry below keeps
  // asking. A focus event can't be relied on to fix it: a window that already
  // has focus never gets one, so a tree loaded during an outage stayed stale.
  const networkListFor = useRef<string | null>(cached ? url : null);
  // Consecutive failed requests for the list — the retry's backoff.
  const failedLoads = useRef(0);
  const { vaults: vaultsPort } = useDocsPorts();
  useEffect(() => {
    if (awaitingScope) return; // nothing to ask for yet — keep showing "Loading…"
    const silent = loadedOnceRef.current;
    let retry: ReturnType<typeof setTimeout> | undefined;
    if (!silent) setLoading(true);
    let cancelled = false;
    // The network answered: it is the fuller picture, so it replaces what we have.
    const apply = (d: { docs?: DocMeta[] } | undefined) => {
      if (!cancelled && d) setDocs(d.docs ?? []);
    };
    const fromIndex = (local: VaultIndexEntry[]) =>
      local.map((d) => ({
        id: d.id,
        title: d.title,
        path: d.path,
        version: d.version,
        updated_at: d.updated_at,
      }));
    const readDisk = (): Promise<VaultIndexEntry[] | null> =>
      vaultId && !isSharedScope(vaultId)
        ? readLocalVaultDocs(vaultsPort, vaultId)
        : Promise.resolve(null);

    // 1. Memory, if this session already fetched it — fresher than the disk.
    // 2. Otherwise the disk, painted the moment it is read.
    if (!peekDocList(url)) {
      void readDisk().then((local) => {
        // Unless the network got here first; never replace fresher with older.
        if (cancelled || loadedOnceRef.current || !local) return;
        setDocs(fromIndex(local));
        setLoading(false);
      });
    }

    // 3. The network, always — for what the disk cannot know.
    fetchDocList<{ docs?: DocMeta[] }>(url)
      .then((d) => {
        apply(d);
        if (cancelled) return;
        setLoadError(false);
        networkListFor.current = url;
        failedLoads.current = 0;
      })
      .catch(async () => {
        // Not the network's list on screen yet: ask again, less often each time.
        if (!cancelled && networkListFor.current !== url) {
          retry = setTimeout(
            () => setReloadNonce((n) => n + 1),
            nextPollDelay(LIST_RETRY_MS, ++failedLoads.current)
          );
        }
        // A refresh that fails while a good list is on screen leaves it there.
        if (cancelled || loadedOnceRef.current) return;
        // Nothing on screen yet, so try the disk before admitting defeat: being
        // offline is not the same as the vault being empty.
        const local = await readDisk();
        if (cancelled) return;
        if (local) setDocs(fromIndex(local));
        else setLoadError(true);
      })
      .finally(() => {
        if (cancelled) return;
        loadedOnceRef.current = true;
        if (!silent) setLoading(false);
      });
    const unsubscribe = subscribeDocLists(() => apply(peekDocList(url)));
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      unsubscribe();
    };
  }, [url, vaultId, reloadKey, reloadNonce, awaitingScope, vaultsPort]);

  // Follow the vault: switching to another one shows ITS arrangement, not the
  // one left over from the vault before it.
  const shownVault = useRef(vaultId);
  useEffect(() => {
    if (shownVault.current === vaultId) return;
    shownVault.current = vaultId;
    setCollapsed(readCollapsed(vaultId));
  }, [vaultId]);

  useEffect(() => {
    writeCollapsed(vaultId, collapsed);
  }, [vaultId, collapsed]);

  // The same folder engine the vault uses, so the web tree and the folders on
  // disk are always the same shape. Two docs can share a path (e.g. two untitled
  // ones), so a path maps to a list.
  const { root, docsByPath, paths } = useMemo(() => {
    const byPath = new Map<string, DocMeta[]>();
    for (const d of docs) {
      const p = pathOf(d);
      const at = byPath.get(p);
      if (at) at.push(d);
      else byPath.set(p, [d]);
    }
    const ps = [...byPath.keys()];
    return { root: buildFolderTree(ps), docsByPath: byPath, paths: ps };
  }, [docs]);

  /**
   * Apply the moves the folder engine computed: every affected document's path is
   * written back with PATCH. The vault picks the change up over the CRDT and moves
   * the file on disk — same engine, same result, whichever side you drag on.
   */
  async function applyMoves(moves: Move[]) {
    if (readOnly || moves.length === 0 || busy) return;
    const targets = moves.flatMap((mv) =>
      (docsByPath.get(mv.from) ?? []).map((d) => ({ id: d.id, to: mv.to }))
    );
    if (targets.length === 0) return;

    setBusy(true);
    const before = docs;
    // Optimistic: re-render the tree immediately.
    setDocs((ds) =>
      ds.map((d) => {
        const t = targets.find((x) => x.id === d.id);
        return t ? { ...d, path: t.to } : d;
      })
    );
    try {
      const results = await Promise.all(
        targets.map((t) =>
          api.request(`/api/v1/docs/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: t.to }),
          })
        )
      );
      if (results.some((r) => !r.ok)) setDocs(before); // roll back on any failure
    } catch {
      setDocs(before);
    } finally {
      // Paths changed (or a rollback did) — the cached lists describe neither.
      invalidateDocLists();
      setBusy(false);
    }
  }

  function onDropOn(targetFolder: string) {
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d) return;
    try {
      if (d.kind === "doc") {
        const filename = d.path.slice(d.path.lastIndexOf("/") + 1);
        const to = filePathIn(targetFolder, filename);
        if (to !== d.path) void applyMoves([{ from: d.path, to }]);
      } else {
        void applyMoves(moveFolder(paths, d.path, targetFolder));
      }
    } catch (e) {
      // The engine refuses a folder moved into itself/a descendant, or a collision.
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Rename a document. The explicit gesture — and the only one there was not.
   *
   * Titling used to happen only as a side effect of editing: type a heading, and
   * the document (and, because the path follows the title, the FILE) was renamed
   * under you. That is how a blog post became "The setup.md" and its original went
   * to .trash. Automatic titling is now limited to documents that have no title,
   * which leaves renaming needing somewhere deliberate to live. Here it is, beside
   * the folder rename it mirrors.
   */
  async function renameDoc(doc: DocMeta) {
    const current = doc.title ?? "";
    const next = await ask({
      title: `Rename "${current || "Untitled"}"`,
      initial: current,
      confirmLabel: "Rename",
    });
    if (!next || next === current) return;

    const before = docs;
    // Optimistic: the tree reads better if the new name lands immediately.
    setDocs((ds) => ds.map((d) => (d.id === doc.id ? { ...d, title: next } : d)));
    try {
      const res = await api.request(`/api/v1/docs/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // The heading follows: the name on the left and the h1 on the right
        // are the same thing, whichever one was edited.
        body: JSON.stringify({ title: next, syncHeading: true }),
      });
      if (!res.ok) throw new Error(`Couldn't rename "${current || "Untitled"}"`);
      // The title moved, and the server moved the path with it — the cached lists
      // still carry both old values.
      invalidateDocLists();
    } catch (e) {
      setDocs(before);
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function rename(folder: string) {
    const current = folder.slice(folder.lastIndexOf("/") + 1);
    const next = await ask({ title: `Rename "${current}"`, initial: current, confirmLabel: "Rename" });
    if (!next || next === current) return;
    try {
      void applyMoves(renameFolder(paths, folder, next));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Delete a folder — meaning the documents in it. A folder has no existence of
   * its own here: it IS the shared prefix of its documents' paths, so there is
   * nothing else to remove.
   */
  async function removeFolder(folder: string) {
    if (readOnly || busy) return;
    const victims = filesUnder(paths, folder).flatMap((path) => docsByPath.get(path) ?? []);
    const name = folder.slice(folder.lastIndexOf("/") + 1);
    const ok = confirm(
      victims.length === 0
        ? `Delete the folder "${name}"?`
        : `Delete "${name}" and the ${victims.length} document${victims.length === 1 ? "" : "s"} in it?\n\n` +
            victims.map((d) => `  • ${d.title || "Untitled"}`).join("\n") +
            `\n\nThis can't be undone.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      // Sequential on purpose: a partial failure should stop rather than race on,
      // and a folder holds few enough documents that it costs nothing.
      for (const d of victims) {
        const res = await api.request(`/api/v1/docs/${d.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`Couldn't delete "${d.title || "Untitled"}"`);
      }
      setDocs((prev) => prev.filter((d) => !victims.some((v) => v.id === d.id)));
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      refresh(); // resync after a partial delete rather than guess
    } finally {
      invalidateDocLists(); // documents are gone; the cached lists still list them
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (deleting) return;
    if (!confirm("Delete this document? This can't be undone.")) return;
    setDeleting(id);
    try {
      const res = await api.request(`/api/v1/docs/${id}`, { method: "DELETE" });
      if (res.ok) {
        setDocs((ds) => ds.filter((d) => d.id !== id));
        invalidateDocLists(); // the cached lists still list this document
      }
    } finally {
      setDeleting(null);
    }
  }

  function DocRow({ doc, depth }: { doc: DocMeta; depth: number }) {
    const p = pathOf(doc);
    return (
      <li
        className={cn(
          "group flex items-center hover:bg-muted",
          drag?.path === p && "opacity-50"
        )}
        draggable={!readOnly}
        onDragStart={() => !readOnly && setDrag({ kind: "doc", path: p })}
        onDragEnd={() => {
          setDrag(null);
          setDropTarget(null);
        }}
      >
        <button
          type="button"
          onClick={(e) => onOpenDoc(doc.id, doc.title, intentFromClick(e))}
          // Middle-click opens a new tab. It never fires `click`, and its default
          // on mousedown is autoscroll — hence both.
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault();
          }}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            onOpenDoc(doc.id, doc.title, "new");
          }}
          className={cn(
            "flex min-w-0 flex-1 items-center text-left text-muted-foreground",
            dense ? "py-1 pr-2 text-sm" : "py-3 pr-4"
          )}
          // Indent past where a folder's chevron (size-4) + gap sits, so a
          // root doc's title lines up with folder names instead of hugging the edge.
          style={{ paddingLeft: `${(dense ? 8 : 16) + depth * (dense ? 14 : 20) + 24}px` }}
        >
          <span className="min-w-0 flex-1 truncate">
            {doc.title || "Untitled"}
          </span>
          {!dense && (
            <span className="shrink-0 text-xs text-muted-foreground">
              <LocalDate value={doc.updated_at} />
            </span>
          )}
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => void renameDoc(doc)}
            aria-label={`Rename document ${doc.title || "Untitled"}`}
            title="Rename document"
            className={cn(
              "shrink-0 rounded-md p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground",
              dense ? "p-1" : ""
            )}
          >
            <Pencil className="size-4" />
          </button>
        )}
        {!readOnly && (
          <button
            type="button"
            onClick={() => remove(doc.id)}
            disabled={deleting === doc.id}
            aria-label="Delete document"
            title="Delete document"
            className={cn(
              "shrink-0 rounded-md p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive disabled:opacity-100",
              dense ? "mr-1 p-1" : "mr-2"
            )}
          >
            {deleting === doc.id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </button>
        )}
      </li>
    );
  }

  function Nodes({ node, depth }: { node: FolderNode; depth: number }) {
    return (
      <>
        {node.folders.map((f) => {
          const open = !collapsed.has(f.path);
          return (
            <li key={f.path} className="list-none">
              <div
                className={cn(
                  "group flex items-center",
                  dropTarget === f.path ? "bg-[#e5ff6e]/30" : "hover:bg-muted"
                )}
                draggable={!readOnly}
                onDragStart={(e) => {
                  if (readOnly) return;
                  e.stopPropagation();
                  setDrag({ kind: "folder", path: f.path });
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setDropTarget(null);
                }}
                onDragOver={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setDropTarget(f.path);
                }}
                onDragLeave={() => setDropTarget((t) => (t === f.path ? null : t))}
                onDrop={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onDropOn(f.path);
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(f.path)}
                  aria-expanded={open}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2 text-left text-muted-foreground",
                    dense ? "py-1 pr-1 text-sm" : "py-2 pr-2"
                  )}
                  style={{ paddingLeft: `${(dense ? 8 : 16) + depth * (dense ? 14 : 20)}px` }}
                >
                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-90"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                </button>
                {!readOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => void rename(f.path)}
                      aria-label={`Rename folder ${f.name}`}
                      title="Rename folder"
                      className="shrink-0 rounded-md p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeFolder(f.path)}
                      disabled={busy}
                      aria-label={`Delete folder ${f.name}`}
                      title="Delete folder and its documents"
                      data-testid={"delete-folder-" + f.path}
                      className={cn(
                        "shrink-0 rounded-md p-2 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-red-600 disabled:opacity-40",
                        dense ? "mr-1 p-1" : "mr-2"
                      )}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </div>
              {open && (
                <ul>
                  <Nodes node={f} depth={depth + 1} />
                </ul>
              )}
            </li>
          );
        })}
        {node.files.flatMap((p) =>
          (docsByPath.get(p) ?? []).map((d) => <DocRow key={d.id} doc={d} depth={depth} />)
        )}
      </>
    );
  }

  function toggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const folderPaths = allFolderPaths(root);
  const anyOpen = folderPaths.some((path) => !collapsed.has(path));

  return (
    <div className={dense ? "flex min-h-0 flex-1 flex-col" : "space-y-4"}>
      {/* One control, not two: with everything shut the only useful next move is
          to open it again. A separate disabled "expand all" beside it would be
          two buttons of which one is always dead. */}
      {folderPaths.length > 0 && (
        <div className={cn("flex justify-end", dense ? "px-2 pb-1" : "")}>
          <button
            type="button"
            onClick={() => setCollapsed(anyOpen ? new Set(folderPaths) : new Set())}
            aria-label={anyOpen ? "Collapse all folders" : "Expand all folders"}
            title={anyOpen ? "Collapse all folders" : "Expand all folders"}
            className="grid size-6 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {anyOpen ? (
              <ChevronsDownUp className="size-4" />
            ) : (
              <ChevronsUpDown className="size-4" />
            )}
          </button>
        </div>
      )}
      {readOnly && vaultsPort && <SharedVaultRow vaults={vaultsPort} dense={dense} />}
      {loading ? (
        // Rows where the rows will be, rather than the word "Loading…" over an
        // empty sidebar — the tree is the first thing on screen, so a blank one
        // is what makes the whole window look broken.
        <div className={cn("space-y-1.5", dense && "px-2")} aria-busy="true">
          <span className="sr-only">Loading documents…</span>
          {["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-3/4", "w-1/2"].map((w, i) => (
            <div key={i} className="flex items-center gap-2" aria-hidden>
              <div className="size-4 shrink-0 animate-pulse rounded bg-muted" />
              <div className={cn("h-3.5 animate-pulse rounded bg-muted/70", w)} />
            </div>
          ))}
        </div>
      ) : docs.length === 0 && syncing ? (
        // Empty AND syncing is not empty — it is the first seconds of a mount.
        // Saying "Nothing in this vault yet. Create a document to start." while
        // hundreds of files upload is the single most misleading thing this tree
        // can say, and it is what a new vault showed for its entire first pass.
        <SyncingRows syncing={syncing} dense={dense} />
      ) : loadError && docs.length === 0 ? (
        <div className={cn("space-y-2 text-sm", dense && "px-2")}>
          <p className="text-muted-foreground">Couldn&rsquo;t load this vault&rsquo;s documents.</p>
          <button
            type="button"
            onClick={() => {
              setLoadError(false);
              setLoading(true);
              setReloadNonce((n) => n + 1);
            }}
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
          >
            Try again
          </button>
        </div>
      ) : docs.length === 0 ? (
        <p className={cn("text-sm text-muted-foreground", dense && "px-2")}>
          {readOnly
            ? "Nothing shared with you yet."
            : vaultId
              ? "Nothing in this vault yet. Create a document to start."
              : "No documents yet. Create one to start."}
        </p>
      ) : (
        // Dropping on the list background moves the item to the vault root.
        <ul
          className={cn(
            dense ? "min-h-0 flex-1 overflow-y-auto" : "divide-y rounded-lg border",
            dropTarget === "" && (dense ? "bg-[#e5ff6e]/10" : "ring-2 ring-[#e5ff6e]"),
            busy && "opacity-60"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDropTarget("");
          }}
          onDragLeave={() => setDropTarget((t) => (t === "" ? null : t))}
          onDrop={(e) => {
            e.preventDefault();
            onDropOn("");
          }}
        >
          <Nodes node={root} depth={0} />
          {/* Still arriving — under what is already here, so the list reads as
              growing rather than as finished-but-short. */}
          {syncing && (
            <li className={cn(dense ? "pt-1" : "px-3 py-2")}>
              <SyncingRows syncing={syncing} dense={dense} rows={2} />
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * "More is coming, and here is how much."
 *
 * Skeleton rows plus a count, shown BELOW whatever has already landed. A mount
 * adopts one document per network round trip — hundreds of files is minutes —
 * and without this the tree looked finished the moment it had anything at all.
 */
/**
 * "Shared with me" on the desktop: whether these documents are also a folder on
 * this machine — the Shared Vault (docs/shared-vault.md) — and the one action
 * when they are not. The folder is proposed at ~/Markbase/shared by the host;
 * the daemon lays the documents out by owner, read-only where you may only read.
 */
function SharedVaultRow({ vaults, dense }: { vaults: VaultsPort; dense: boolean }) {
  const { dirs, supported, refresh } = useMountedVaults();
  const [mounting, setMounting] = useState(false);
  if (!supported) return null;
  const dir = dirs[SHARED_SCOPE];
  const mount = async (): Promise<void> => {
    setMounting(true);
    try {
      const res = await vaults.mount(SHARED_SCOPE, "Shared Vault", false);
      if (!res.ok && !res.canceled) alert(res.error ?? "Couldn't sync the shared documents to a folder.");
      await refresh();
    } finally {
      setMounting(false);
    }
  };
  return (
    <div className={cn("mb-2 text-xs text-muted-foreground", dense && "px-2")}>
      {dir ? (
        <span className="flex items-center gap-1.5" title={dir}>
          <FolderSync className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">Synced to {dir}</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void mount()}
          disabled={mounting}
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 hover:bg-muted disabled:opacity-50"
        >
          {mounting ? <Loader2 className="size-3.5 animate-spin" /> : <FolderSync className="size-3.5" />}
          Sync shared documents to a folder
        </button>
      )}
    </div>
  );
}

function SyncingRows({
  syncing,
  dense,
  rows = 4,
}: {
  syncing: { done: number; total: number };
  dense?: boolean;
  rows?: number;
}) {
  const widths = ["w-4/5", "w-3/5", "w-11/12", "w-2/3"];
  return (
    <div className={cn("space-y-1.5", dense && "px-2")} aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2" aria-hidden>
          <div className="size-4 shrink-0 animate-pulse rounded bg-muted" />
          <div className={cn("h-3.5 animate-pulse rounded bg-muted/70", widths[i % widths.length])} />
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        Syncing this folder — {syncing.done.toLocaleString()} of{" "}
        {syncing.total.toLocaleString()} files
      </p>
    </div>
  );
}
