"use client";

import { api } from "@markbase/protocol/api-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { docJsonIsValid, emptyDoc, type DocJSON } from "@markbase/docs";
import type { Capability } from "@markbase/docs/server";

// Client-side cache of the data a document workspace needs — the same thing the
// server component used to compute per request (subtabs + capability + vault).
// Loaded once per doc and kept, so opening a tab you've seen before is instant.
// Everything still comes from Supabase via /api/v1/docs; this just stops us
// re-fetching + remounting on every switch.

export type WorkspaceTab = {
  id: string;
  title: string;
  doc_json: DocJSON;
  version: number;
  /**
   * Markdown to seed the CRDT with — used ONLY when the cloud has no snapshot
   * for this document yet (a doc created through the API, whose content lives in
   * its row). Once a snapshot exists it is the truth and this is ignored.
   *
   * It is not the content to display: we ask the API not to derive that (see
   * `?derive=0`), because the editor loads the authoritative CRDT itself.
   */
  seedMarkdown: string;
};

export type LoadedWorkspace = {
  docId: string;
  /**
   * True while this was assembled from LOCAL data alone — the vault index and the
   * on-disk snapshot — because the server hasn't answered yet.
   *
   * Content is real; the cloud-only facts are not yet known, so capability is
   * held at its safest value and the chrome that depends on it stays hidden. The
   * entry is replaced wholesale when the real one arrives.
   */
  provisional?: boolean;
  /**
   * Whether this doc is published, and where — already on the row the API
   * returned, so the Publish button doesn't need a request of its own. That
   * request cost 1.2s on every document open, for data we were holding.
   */
  publish: { published: boolean; url: string | null };
  vaultId: string | null;
  /** The doc's vault-relative file path (e.g. "learning/report.md"), for agents
   *  that operate on the file on disk. Null for a doc the daemon hasn't placed yet. */
  path: string | null;
  capability: Capability;
  tabDocs: WorkspaceTab[];
};

export type WorkspaceEntry =
  | { status: "loading" }
  | { status: "ready"; data: LoadedWorkspace }
  | { status: "no-access" }
  | { status: "not-found" }
  | { status: "invalid" }
  | { status: "error"; message: string };

type DocGet = {
  doc?: {
    id: string;
    title: string;
    doc_json: DocJSON;
    content?: string;
    version: number;
    vault_id: string | null;
    path?: string | null;
    public_slug?: string | null;
    published_at?: string | null;
  };
  capability?: Capability | null;
  tabs?: { id: string; title: string; position: number }[];
  error?: string;
};

async function fetchOne(id: string): Promise<DocGet & { status: number }> {
  // `derive=0`: don't make the server open the CRDT to project content for us.
  // The editor loads the authoritative snapshot itself and overwrites anything
  // we'd be sent — so deriving it here is a round trip spent on a value that is
  // discarded a moment later. We still get `content`, the seed for a document
  // that has no cloud snapshot yet.
  const res = await api.request(`/api/v1/docs/${id}?derive=0`);
  let body: DocGet = {};
  try {
    body = await res.json();
  } catch {
    // leave body empty
  }
  return { ...body, status: res.status };
}

/** Build the workspace payload for `docId`: its group's tabs, ordered, each with
 *  full content — mirroring what the server page used to assemble. */
async function loadWorkspace(docId: string): Promise<WorkspaceEntry> {
  const main = await fetchOne(docId);
  if (main.status === 404) return { status: "not-found" };
  if (main.status === 401 || main.status === 403) return { status: "no-access" };
  if (main.status >= 400 || !main.doc || !main.capability) {
    return main.capability === null && main.doc
      ? { status: "no-access" }
      : { status: "error", message: main.error ?? "Couldn't load the document." };
  }
  if (!docJsonIsValid(main.doc.doc_json)) return { status: "invalid" };

  const tabs = (main.tabs ?? []).slice().sort((a, b) => a.position - b.position);
  // The main doc is already loaded; fetch the other tabs' content in parallel.
  const loaded = await Promise.all(
    tabs.map((t) => (t.id === docId ? Promise.resolve(main) : fetchOne(t.id)))
  );
  const tabDocs: WorkspaceTab[] = loaded
    .map((r) => r.doc)
    .filter((d): d is NonNullable<typeof d> => !!d && docJsonIsValid(d.doc_json))
    .map((d) => ({
      id: d.id,
      title: d.title,
      doc_json: d.doc_json,
      version: d.version,
      seedMarkdown: d.content ?? "",
    }));

  return {
    status: "ready",
    data: {
      docId,
      publish: {
        published: Boolean(main.doc.published_at),
        url:
          main.doc.published_at && main.doc.public_slug
            ? `${window.location.origin}/p/${main.doc.public_slug}`
            : null,
      },
      vaultId: main.doc.vault_id ?? null,
      path: main.doc.path ?? null,
      capability: main.capability,
      tabDocs,
    },
  };
}

type DocsStore = {
  /**
   * Bumped on every cache write. Carried in the context value so that value
   * changes identity — see DocsStoreProvider. Not meant to be read.
   */
  version: number;
  get: (docId: string) => WorkspaceEntry | undefined;
  load: (docId: string) => void;
  /** Drop a doc from the cache (e.g. on close or after a mutation). */
  invalidate: (docId: string) => void;
};

// ---------------------------------------------------------------------------
// The cache itself lives at MODULE scope, not in React state.
//
// A document you've opened is loaded once and kept until the app restarts. Held
// in a provider's useState it died with every unmount — leaving the surface, or
// any remount, meant re-fetching content we already had, over a link where each
// round trip costs a third of a second. At module scope the map outlives the
// component tree, so reopening a document is free.
// ---------------------------------------------------------------------------

const entries = new Map<string, WorkspaceEntry>();
/** Ids already kicked off, so load() is idempotent across every caller. */
const requested = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function set(docId: string, entry: WorkspaceEntry): void {
  entries.set(docId, entry);
  emit();
}

/**
 * Load `docId`'s workspace into the cache if it isn't there already. Idempotent:
 * calling it for a doc that's loaded (or loading) does nothing.
 */
export function loadDocWorkspace(docId: string): Promise<void> {
  if (requested.has(docId)) return Promise.resolve();
  requested.add(docId);
  // Only claim "loading" if we have nothing to show. A provisional entry built
  // from local data is strictly better than a skeleton, and must not be replaced
  // by one.
  if (!entries.has(docId)) set(docId, { status: "loading" });
  return loadWorkspace(docId)
    .then((entry) => set(docId, entry))
    .catch((e) => {
      // A failed load must not poison the id forever — let a retry through.
      requested.delete(docId);
      set(docId, {
        status: "error",
        message: e instanceof Error ? e.message : "Couldn't load the document.",
      });
    });
}

/**
 * Show a document from what this machine already holds, without waiting for the
 * server.
 *
 * The content is on disk and the vault index names it; what is missing is the
 * cloud's word on permissions, publishing and subtabs. So this fills in what is
 * known and marks the rest unknown: capability is "viewer", which makes the
 * editor read-only and hides Share and Publish. When the real entry lands it
 * replaces this one, `editor.setEditable` flips, and the chrome appears.
 *
 * Read-only is the safe direction. Guessing "owner" would let someone type into
 * a document they may not be allowed to edit, and a CRDT broadcasts as it goes.
 *
 * Never overwrites a real entry, and never applies to a doc whose content is not
 * actually here — the caller checks that first (see readLocalDoc).
 */
export function seedLocalWorkspace(
  docId: string,
  local: { vaultId: string; title: string; path: string | null }
): void {
  const existing = entries.get(docId);
  if (existing && existing.status !== "loading") return;
  set(docId, {
    status: "ready",
    data: {
      docId,
      provisional: true,
      vaultId: local.vaultId,
      path: local.path,
      capability: "viewer",
      publish: { published: false, url: null },
      // One tab, empty: the CRDT the editor binds to carries the text, and it is
      // already on this machine. `seedMarkdown` stays empty on purpose — it is
      // only consulted when the cloud has NO snapshot, and the caller has already
      // established that one is here.
      tabDocs: [{ id: docId, title: local.title, doc_json: emptyDoc().toJSON() as DocJSON, version: 0, seedMarkdown: "" }],
    },
  });
}

/**
 * How many open tabs to warm at once. Background warming must never monopolise
 * the connection: firing a dozen at once made the document you were actually
 * navigating to queue behind them, which on a slow link turned a 2-second
 * navigation into a 30-second one. Two at a time keeps the queue short.
 */
const PRELOAD_CONCURRENCY = 2;

/**
 * Warm the cache for documents that are already open — the tabs restored from
 * localStorage at startup. They're going to be read the moment the user clicks
 * one, so fetch them now rather than making each first click wait.
 *
 * Paced, not parallel: this is background work and it yields to whatever the
 * user is doing. A doc that gets opened meanwhile is loaded on demand and simply
 * skipped when the queue reaches it.
 */
export function preloadDocWorkspaces(docIds: string[]): void {
  const queue = [...docIds];
  const pump = async (): Promise<void> => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      await loadDocWorkspace(id);
    }
  };
  for (let i = 0; i < PRELOAD_CONCURRENCY; i++) void pump();
}

const Ctx = createContext<DocsStore | null>(null);

export function useDocsStore(): DocsStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDocsStore must be used within <DocsStoreProvider>");
  return ctx;
}

export function DocsStoreProvider({ children }: { children: React.ReactNode }) {
  // Re-render on cache writes. The data is in the module map; this is only the
  // notification that it changed.
  const [version, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const load = useCallback((docId: string) => loadDocWorkspace(docId), []);

  const invalidate = useCallback((docId: string) => {
    requested.delete(docId);
    if (entries.delete(docId)) emit();
  }, []);

  const get = useCallback((docId: string) => entries.get(docId), []);

  // A NEW object per version, deliberately.
  //
  // `get`, `load` and `invalidate` are all stable, so without `version` this
  // value never changed identity — and a context value that doesn't change
  // re-renders nobody. Since the entries themselves live in a module map rather
  // than in state, a fresh value is the ONLY thing that tells a consumer to read
  // them again. Without it a document would finish loading and simply not
  // appear: the provider re-rendered, `children` was the same element, React
  // skipped the subtree, and the editor stayed unmounted until something else
  // (switching tabs) re-rendered the workspace.
  const value = useMemo(
    () => ({ get, load, invalidate, version }),
    [get, load, invalidate, version]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
