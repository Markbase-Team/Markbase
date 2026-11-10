"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ChatSessionMeta, ChatTurn, StreamChunk } from "@markbase/agent";

// What the documents surface needs from the machine it is running on.
//
// Some of what this surface does cannot be done from a web page: mount a vault
// to a folder, run Claude in that folder, write a loose `.md` file back to disk,
// serve a document's CRDT from a snapshot on disk, follow a `file://` link. The
// desktop shell can do all of it, through its preload bridge; a browser can do
// none of it. The components used to find out which they were in by reading
// the shell's bridge off the window, which pinned every one of them to the
// shape of one shell's global — and made the question "what does this
// component need from its host" unanswerable without grepping for the global.
//
// Now they ask for these. Each port is the slice one concern needs, named for
// the concern rather than the process on the other end; a port that is `null`
// means the host has nothing to offer for it, and the component behaves as the
// web always has. The shell builds the set once (apps/app's dashboard page
// assembles it from the bridge; apps/web passes `browserDocsPorts`) and hands
// it to DocsShell, which provides it to everything beneath — the same seam as
// DocsRouting and the navigation port, for the same reason.

/** A loose markdown file a desktop window was opened on. */
export interface LocalFile {
  path: string;
  dir: string;
  name: string;
  content: string;
  /** Set instead of content when the file could not be read. */
  error?: string;
  /** Set when the file could not be watched: edits made elsewhere will not show. */
  watchError?: string;
}

/** How a write back to that file went. A value rather than a rejection, so the
 *  message arrives as the host wrote it. */
export type LocalSaveResult = { ok: true } | { ok: false; error: string };

export interface MountResult {
  ok: boolean;
  /** Where the vault was mounted, when ok. */
  dir?: string;
  /** The user dismissed the folder picker. */
  canceled?: boolean;
  /** A refusal (e.g. the folder overlaps another vault); already shown natively. */
  error?: string;
}

/** How far a vault's first sync has got. */
export interface VaultProgress {
  vaultId: string;
  phase: "opening" | "adopting";
  done: number;
  total: number;
}

/** A vault folder on this machine. */
export interface MountedVault {
  vaultId: string;
  /** Absent on older desktop builds; the folder's name is the next best. */
  name?: string;
  dir: string;
}

/** One document, as the vault folder on disk knows it. */
export interface VaultIndexEntry {
  id: string;
  title: string;
  path: string | null;
  /** The file it occupies in the vault — differs from `path` on a name clash. */
  file: string;
  version: number;
  updated_at: string;
}

/** What the vault folder on disk knows about itself. */
export interface VaultIndex {
  version: 1;
  vaultId: string;
  updatedAt: string;
  docs: VaultIndexEntry[];
}

export type RefreshState = "start" | "done" | "failed";

/** The outcome of asking the host to do something it may refuse. */
export interface Outcome {
  ok: boolean;
  error?: string;
}

/**
 * Open a URL outside the surface.
 *
 * An http(s) address goes to the browser; a `file://` link to whatever the
 * machine uses for that file. A page served over http: cannot follow a file:
 * link itself, so on the desktop this is the only route local links have.
 */
export interface LinksPort {
  openExternal(url: string): void;
}

/**
 * The vault folders on this machine. Null in a browser, which has none: the
 * vault list then shows no local/cloud distinction, offers no Mount or
 * Unmount, and New Vault takes only a name.
 */
export interface VaultsPort {
  /** Which vaults are mounted as folders here, and where. */
  mounted(): Promise<MountedVault[]>;
  /**
   * Vault ids deliberately unmounted here, which the surface hides. Distinct
   * from "not mounted here": a vault made elsewhere and never brought onto this
   * machine is absent from this list and stays visible, or there would be no
   * way to mount it. Mounting clears the record.
   */
  unmounted(): Promise<string[]>;
  /** Pick a local folder and mount an already-created cloud vault to it. */
  mount(
    vaultId: string,
    name: string,
    isFirstVault: boolean,
    /** A folder already chosen with `chooseFolder`; omit to pick one now. */
    dir?: string
  ): Promise<MountResult>;
  /** Stop syncing a vault here. The folder and its files stay where they are. */
  unmount(vaultId: string): Promise<Outcome>;
  /**
   * May a new vault called `name` live in `dir` — or, with no `dir`, in the
   * host's default folder for it? Answers the folder Create will use, or why
   * it cannot. Asked before the vault is created, so a taken folder — the
   * default one included — is refused while there is still nothing to undo.
   */
  checkFolder(name: string, dir?: string): Promise<{ dir?: string; refused?: string }>;
  /** The native folder picker on its own, before any vault exists. `refused`:
   *  the folder belongs to or overlaps another vault, and the host has said so. */
  chooseFolder(
    name?: string,
    isFirstVault?: boolean
  ): Promise<{ dir?: string; canceled?: boolean; refused?: boolean }>;
  /** What the vault folder knows about itself; null when it isn't mounted here
   *  or has never synced. */
  index(vaultId: string): Promise<VaultIndex | null>;
  /** How far a vault's first sync has got. Returns an unsubscribe. */
  onProgress(cb: (p: VaultProgress) => void): () => void;
  /** A vault's document SET changed here — a file adopted, a document moved.
   *  Returns an unsubscribe. */
  onDocsChanged(cb: (p: { vaultId: string }) => void): () => void;
  /**
   * The set of vaults mounted on this machine changed — one was mounted,
   * unmounted, reconnected or retired, from ANY surface: the native Vaults
   * menu, the first-run offer, the tray, the CLI, not only this window. The
   * list read `mounted()` once; without this a vault mounted through a native
   * dialog stayed "cloud only" in the switcher until something re-rendered it.
   * Absent on older desktop builds. Returns an unsubscribe.
   */
  onMountsChanged?(cb: () => void): () => void;
}

/** A Claude turn in a vault, streamed back. */
export interface AgentChatPort {
  start(
    sessionId: string,
    params: { prompt: string; vaultId: string; docId?: string; docPath?: string; resume?: string }
  ): Promise<Outcome>;
  cancel(sessionId: string): void;
  /** The panel is closing for good — end the process holding its conversation. */
  close(sessionId: string): void;
  onChunk(sessionId: string, cb: (chunk: StreamChunk) => void): () => void;
  onEnd(sessionId: string, cb: (result: Outcome) => void): () => void;
}

/** Persisted conversations: the vault's `.chat/` index, and the transcript
 *  read back from the agent's own store on reopen. */
export interface AgentSessionsPort {
  list(vaultId: string, docId?: string): Promise<ChatSessionMeta[]>;
  get(vaultId: string, id: string): Promise<ChatSessionMeta | null>;
  save(vaultId: string, meta: ChatSessionMeta): Promise<void>;
  delete(vaultId: string, id: string): Promise<void>;
  transcript(vaultId: string, sessionId: string): Promise<ChatTurn[] | null>;
}

/**
 * A coding agent on this machine. Null in a browser: the Claude tab then says
 * the chat needs the desktop app, and the external agents are not offered.
 */
export interface AgentPort {
  /**
   * Is the agent signed in? Resolves `{ ready: true }` when it is; otherwise the
   * host opens its own sign-in and resolves `{ ready: false }` — leave the panel
   * shut, the user is being asked to connect.
   */
  ensureReady(): Promise<{ ready: boolean; error?: string }>;
  /** Open an external agent app (Codex, Cursor, …) in the vault's folder. */
  open(agentId: string, vaultId: string, docId?: string): Promise<Outcome>;
  chat: AgentChatPort;
  sessions: AgentSessionsPort;
}

/**
 * A host menu that claims the tab keys (⌘T, ⌘W, ⌘⇧T, ⌘⌥←/→, ⌃Tab, ⌃⇧Tab)
 * before the page sees them, and sends them on as commands — "newTab",
 * "closeTab", "reopenClosedTab", "back", "forward", "nextTab", "prevTab".
 * Null where the page owns its own keys.
 */
export interface TabMenuPort {
  onCommand(cb: (command: string) => void): () => void;
}

/**
 * A document's CRDT served by the host from a snapshot on disk, so opening
 * one does not wait on the network. Null in a browser, where the cloud is
 * asked directly. Yjs state is binary; it crosses as bytes both ways.
 */
export interface CrdtPort {
  load(docId: string): Promise<Uint8Array | null>;
  /** Whether the host already holds this document's snapshot. */
  has(docId: string): Promise<boolean>;
  save(docId: string, bytes: Uint8Array): Promise<void>;
  /** The host has a newer snapshot of a document — a stale cache catching up,
   *  or an edit made elsewhere that its poll of the API found. Applied as an
   *  ordinary update; a whole snapshot merges. Returns an unsubscribe. */
  onUpdate(docId: string, cb: (update: Uint8Array) => void): () => void;
  /** Where a document's cloud refresh has got to. Returns an unsubscribe. */
  onRefresh(docId: string, cb: (state: RefreshState) => void): () => void;
}

/**
 * The file a window was opened on, for the loose-file editor (see
 * local-file-crdt.ts). No path crosses: the host writes to the file the window
 * was opened on and nothing else. Null everywhere but that window.
 */
export interface LocalFilePort {
  save(content: string): Promise<LocalSaveResult>;
  /** Show or clear the unsaved dot in the window's title bar. */
  setEdited(edited: boolean): void;
  /** The file changed on disk under the window — not by us. Returns an unsubscribe. */
  onChanged(cb: (file: LocalFile) => void): () => void;
  /** The window is closing: write what is unsaved and report how it went. */
  onFlush(cb: () => Promise<LocalSaveResult>): () => void;
}

/** A shared document edited here without the right to — see docs/shared-vault.md. */
export interface LocalFork {
  docId: string;
  /** Where it is in the Shared Vault folder. */
  path: string;
  title: string;
  /** When the fork was first noticed. */
  since: string;
}

/**
 * The Shared Vault's forks on this machine: documents shared read-only whose
 * file was edited anyway. The daemon keeps those edits as a live fork — merged
 * with what the cloud sends, never sent up — and this is how the surface
 * shows them and offers the ways out. Null in a browser, and on a machine with
 * no Shared Vault mounted.
 */
export interface ForksPort {
  list(): Promise<LocalFork[]>;
  /** Both texts, for a comparison. Null once the fork is gone. */
  compare(docId: string): Promise<{ cloud: string; local: string; path: string; title: string } | null>;
  /** Drop the local edits: the file is the cloud's again. */
  discard(docId: string): Promise<Outcome>;
  /** Save the local text as a new document in one of the person's own vaults, then discard. */
  keepCopy(docId: string, vaultId: string): Promise<Outcome & { docId?: string }>;
  /** The set of forks changed. Returns an unsubscribe. */
  onChanged(cb: (forks: LocalFork[]) => void): () => void;
}

/** Everything the documents surface may ask its host for. */
export interface DocsPorts {
  links: LinksPort;
  vaults: VaultsPort | null;
  agent: AgentPort | null;
  tabMenu: TabMenuPort | null;
  crdt: CrdtPort | null;
  localFile: LocalFilePort | null;
  forks: ForksPort | null;
}

/**
 * The browser's answer: links open in a new tab, and there is nothing local.
 * What the web shell passes, and what a component gets when no shell has
 * provided anything — a page with no provider above it is a browser page.
 */
export const browserDocsPorts: DocsPorts = {
  links: {
    openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  },
  vaults: null,
  agent: null,
  tabMenu: null,
  crdt: null,
  localFile: null,
  forks: null,
};

const DocsPortsContext = createContext<DocsPorts | null>(null);

export function DocsPortsProvider({ value, children }: { value: DocsPorts; children: ReactNode }) {
  return <DocsPortsContext.Provider value={value}>{children}</DocsPortsContext.Provider>;
}

/**
 * The host's ports. `browserDocsPorts` when no shell supplied any.
 *
 * Falling back rather than throwing, unlike the navigation port: a browser
 * needs nothing provided to be a browser, and the published and shared pages
 * mount an editor with no shell around it at all.
 */
export function useDocsPorts(): DocsPorts {
  return useContext(DocsPortsContext) ?? browserDocsPorts;
}
