import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { StreamChunk, ChatSessionMeta, ChatTurn } from "@markbase/agent";
import type {
  AgentPort,
  CrdtPort,
  ForksPort,
  LocalFile,
  LocalFork,
  LocalFilePort,
  LocalSaveResult,
  MountResult,
  MountedVault,
  Outcome,
  TabMenuPort,
  VaultIndex,
  VaultProgress,
  VaultsPort,
} from "@markbase/docs/ui/ports";
import type { DesktopApiRequest, DesktopApiResponse } from "./api-bridge";
import type { InstanceConnectResult, InstanceStatus } from "./instance";
import type { McpInstallResult } from "@markbase/node/mcp-install";

// The one bridge between a page and the desktop shell. contextIsolation is on
// and nodeIntegration off, so the renderer can't touch Node or Electron — it
// gets exactly this surface and nothing else.
//
// Not one surface, though: one per KIND of window. The dashboard mounts vaults,
// runs the agent and serves documents from disk; the file viewer writes one
// file back; the onboarding page signs in to Claude. Each used to receive the
// whole flat object, so the viewer could have started a PTY and the onboarding
// page could have unmounted a vault. Now main says
// which window it is making (`--markbase-window=<kind>` in additionalArguments,
// read off argv below) and the page gets the slices that window is for.
//
// The slices are grouped by concern and typed against the ports the docs
// feature asks its host for (@markbase/docs/ui/ports), so a page hands them
// straight in: the shell's job is to say which process is on the other end,
// and the compiler holds the shape.

export type { LocalFile, LocalSaveResult, MountResult };

/** Where the API is, and whether this machine may use it. The key itself never
 *  crosses: a page that wants the API calls `api` and main attaches it there. */
export interface DesktopCredentials {
  appUrl: string;
  /** False until this machine has been authorized; the page then shows sign-in. */
  loggedIn: boolean;
}

/** What `claude auth status --json` reports, as the onboarding screen reads it. */
export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgName?: string;
  subscriptionType?: string;
  error?: string;
}

/** Progress of a sign-in, pushed from main as the CLI subprocess talks. */
export type ClaudeLoginEvent =
  | { type: "url"; url: string }
  | { type: "needs-code" }
  | { type: "output"; text: string }
  | { type: "done"; ok: boolean; error?: string };

/** The kinds of window main makes, each with its own slice of the bridge. */
export type WindowKind = "dashboard" | "viewer" | "onboarding";

// ---- Reaching the API from a local page -------------------------------------
// The pages this app renders itself are markbase://app — a different origin
// from the API, holding no cookie for it. They do not hold the key either: each
// request crosses here, main attaches the key it keeps and makes the call, and
// the page rebuilds a Response from what comes back (see renderer/ipc-api.ts).
// The key exists in one process, and it is not this one.
//
// Asked per request rather than wired once: the key may not exist when the
// window opens, and it changes when the user signs in — main reads it fresh for
// every call, so a page starts working the moment there is one.
export type ApiBridge = (req: DesktopApiRequest) => Promise<DesktopApiResponse>;

/** Signing in from a local page. The flow belongs to main: it shows the site's
 *  /login in the window and stores the key. A page only asks, and hears back
 *  once a key exists (or the attempt was abandoned). */
export interface AuthBridge {
  credentials(): Promise<DesktopCredentials>;
  signIn(): Promise<boolean>;
  /** Forget this app's key and stop syncing; the surface then shows sign-in. */
  signOut(): Promise<void>;
}

/** Giving the agents on this machine the document tools (the docs MCP server). */
export interface AgentsBridge {
  /** Connect Claude Desktop, Claude Code, Codex and Cursor; one result per agent. */
  connectMcp(): Promise<McpInstallResult[]>;
}

/** Being the Mac's default app for markdown files (see ../default-opener.ts). */
export interface DefaultOpenerBridge {
  /** Should the window offer it now? True at most once per machine. */
  shouldOffer(): Promise<boolean>;
  /** The person said yes. True when macOS made this app the default. */
  accept(): Promise<boolean>;
}

/** The file this viewer window was opened on, and the way to write it back. */
export interface FileBridge extends LocalFilePort {
  /** Answered per window: several .md files can be open at once, and main tells
   *  them apart by which WebContents asked. */
  current(): Promise<LocalFile | null>;
}

/** Connecting Claude, for the onboarding window. The binary being driven is the
 *  one bundled in this app, so none of this requires the user to have installed
 *  Claude Code. */
export interface ClaudeBridge {
  authStatus(): Promise<ClaudeAuthStatus>;
  logout(): Promise<Outcome>;
  closeOnboarding(): Promise<void>;
  loginStart(mode: "subscription" | "console"): void;
  loginCode(code: string): void;
  loginCancel(): void;
  onLogin(cb: (ev: ClaudeLoginEvent) => void): () => void;
}

/** Embedded terminal (Claude Code / Codex): start a PTY, stream bytes both ways
 *  by ptyId. onData/onExit return an unsubscribe. */
export interface PtyBridge {
  start(ptyId: string, agentId: string, vaultId: string, cols: number, rows: number): Promise<Outcome>;
  write(ptyId: string, data: string): void;
  resize(ptyId: string, cols: number, rows: number): void;
  kill(ptyId: string): void;
  onData(ptyId: string, cb: (data: string) => void): () => void;
  onExit(ptyId: string, cb: (code: number) => void): () => void;
}

export interface AgentBridge extends AgentPort {
  pty: PtyBridge;
}

interface BridgeBase {
  kind: WindowKind;
  isDesktop: true;
}

/** The main window: the documents surface, with everything the machine offers it. */
export interface DashboardBridge extends BridgeBase {
  kind: "dashboard";
  api: ApiBridge;
  auth: AuthBridge;
  /** Open a URL in the user's real browser, or a `file://` link with whatever
   *  the Mac uses for that file. */
  openExternal(url: string): void;
  vaults: VaultsPort;
  crdt: CrdtPort;
  agent: AgentBridge;
  tabs: TabMenuPort;
  /** The Shared Vault's forks — documents shared read-only and edited here anyway. */
  forks: ForksPort;
  /** Which instance this app is on, and switching — Settings lives in this window. */
  instance: InstanceBridge;
  /** Main asks the window to open Settings (the tray's and the Vaults menu's "Settings…"). */
  onOpenSettings(cb: () => void): () => void;
  defaultOpener: DefaultOpenerBridge;
  agents: AgentsBridge;
}

/** A loose `.md` file, opened. Nothing but the file and the editor. */
export interface ViewerBridge extends BridgeBase {
  kind: "viewer";
  openExternal(url: string): void;
  file: FileBridge;
}

/**
 * Which Markbase this app talks to (SELF-HOSTING.md), for the onboarding
 * window's "Connect to a team instance" control. Connecting saves the instance
 * and RELAUNCHES the app: the page hears `changed: true` and is about to go
 * away with the rest of the process.
 */
export interface InstanceBridge {
  current(): Promise<InstanceStatus>;
  connect(url: string): Promise<InstanceConnectResult>;
}

/** The Connect Claude window — and the team instance control, which lives there too. */
export interface OnboardingBridge extends BridgeBase {
  kind: "onboarding";
  openExternal(url: string): void;
  claude: ClaudeBridge;
  instance: InstanceBridge;
}

export interface BridgeByKind {
  dashboard: DashboardBridge;
  viewer: ViewerBridge;
  onboarding: OnboardingBridge;
}

export type MarkbaseBridge = BridgeByKind[WindowKind];

// ---- The pieces ---------------------------------------------------------------

/** Subscribe to a main→renderer channel; the returned function unsubscribes. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ApiBridge = (req) => ipcRenderer.invoke("markbase:api", req);

const auth: AuthBridge = {
  credentials: () => ipcRenderer.invoke("markbase:credentials"),
  signIn: () => ipcRenderer.invoke("markbase:sign-in"),
  signOut: () => ipcRenderer.invoke("markbase:sign-out"),
};

const openExternal = (url: string): void => ipcRenderer.send("markbase:open-external", { url });

// No path crosses here. Main writes to the file this window was opened on and
// refuses any window that is not a file window, so the page cannot name a file
// — only hand back the content of the one it was given.
const file: FileBridge = {
  current: () => ipcRenderer.invoke("markbase:local-file"),
  save: (content: string): Promise<LocalSaveResult> =>
    ipcRenderer.invoke("markbase:save-local-file", { content }),
  /** The unsaved dot in the title bar. The write is debounced, so only the page
   *  knows an edit is waiting. */
  setEdited: (edited: boolean): void => ipcRenderer.send("markbase:local-file-edited", { edited }),
  /** The file changed on disk under this window — somebody else wrote it, or it
   *  went away (`error`). Our own writes are not reported. */
  onChanged: (cb) => on<LocalFile>("markbase:local-file-changed", cb),
  /**
   * Main is closing this window and wants anything unsaved written first. The
   * callback writes and resolves with how it went; the answer goes back on its
   * own channel, and main holds the window open until it arrives.
   */
  onFlush: (cb) =>
    on<void>("markbase:local-file-flush", () => {
      void cb().then(
        (result) => ipcRenderer.send("markbase:local-file-flushed", result),
        (e: Error) =>
          ipcRenderer.send("markbase:local-file-flushed", {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          })
      );
    }),
};

const claude: ClaudeBridge = {
  authStatus: () => ipcRenderer.invoke("claude-auth:status"),
  logout: () => ipcRenderer.invoke("claude-auth:logout"),
  closeOnboarding: () => ipcRenderer.invoke("claude-auth:close-onboarding"),
  loginStart: (mode) => ipcRenderer.send("claude-auth:login", { mode }),
  loginCode: (code) => ipcRenderer.send("claude-auth:login-code", { code }),
  loginCancel: () => ipcRenderer.send("claude-auth:login-cancel"),
  onLogin: (cb) => on<ClaudeLoginEvent>("claude-auth:login-event", cb),
};

const agents: AgentsBridge = {
  connectMcp: () => ipcRenderer.invoke("markbase:mcp-install"),
};

const defaultOpener: DefaultOpenerBridge = {
  shouldOffer: () => ipcRenderer.invoke("markbase:default-opener-offer"),
  accept: () => ipcRenderer.invoke("markbase:default-opener-accept"),
};

const instance: InstanceBridge = {
  current: () => ipcRenderer.invoke("instance:current"),
  connect: (url) => ipcRenderer.invoke("instance:connect", { url }),
};

const vaults: VaultsPort = {
  /**
   * Which vaults are mounted as folders on THIS machine, and where. The vault
   * list uses it to separate "on this Mac" from "cloud only", to decide which
   * rows get a Mount action, and to list the vaults when the server can't.
   */
  mounted: (): Promise<MountedVault[]> => ipcRenderer.invoke("markbase:mounted-vaults"),
  /** Vaults deliberately unmounted on this machine. The app hides them until
   *  they are mounted here again — which clears the record by itself. */
  unmounted: (): Promise<string[]> => ipcRenderer.invoke("markbase:unmounted-vaults"),
  /**
   * Pick a folder and mount an already-created cloud vault to it. The vault row
   * is created on the web first; this only does the local half. `isFirstVault`
   * pre-fills the picker at ~/Markbase.
   */
  mount: (vaultId, name, isFirstVault, dir): Promise<MountResult> =>
    ipcRenderer.invoke("markbase:mount-vault", { vaultId, name, isFirstVault, dir }),
  /**
   * Stop syncing a vault on this machine. The folder and its files stay exactly
   * where they are — this only removes the mount, and records that it was
   * deliberate so nothing reconnects it behind the user's back.
   */
  unmount: (vaultId): Promise<Outcome> => ipcRenderer.invoke("markbase:unmount-vault", { vaultId }),
  /** The folder a new vault would get (the one picked, or the default), and
   *  whether it may have it — asked before the vault is created. */
  checkFolder: (name, dir) => ipcRenderer.invoke("markbase:check-folder", { name, dir }),
  /** Open the native folder picker on its own, before any vault exists. Resolves
   *  `{ canceled: true }` if the user dismisses it. */
  chooseFolder: (name, isFirstVault) =>
    ipcRenderer.invoke("markbase:choose-folder", { name, isFirstVault }),
  /** What the vault folder on disk knows about itself: which document each file
   *  is. Null when the vault isn't mounted here, or has never synced. */
  index: (vaultId): Promise<VaultIndex | null> =>
    ipcRenderer.invoke("markbase:vault-index", { vaultId }),
  /** How far a vault's first sync has got. Fires while documents are being
   *  opened or adopted, throttled in the main process. */
  onProgress: (cb) => on<VaultProgress>("markbase:vault-progress", cb),
  /**
   * A vault's document SET changed here — a file adopted, a document moved. The
   * renderer uses it to drop its cached document lists, so a file an agent wrote
   * appears without waiting for the window to regain focus.
   */
  onDocsChanged: (cb) => on<{ vaultId: string }>("markbase:vault-docs-changed", cb),
  /** The mounted-vault set changed, from any surface (main sends it wherever
   *  it rebuilds the Vaults menu). The switcher re-reads `mounted()` on it. */
  onMountsChanged: (cb) => on<void>("markbase:mounts-changed", () => cb()),
};

// The editor's CRDT transport. The renderer implements DocStore/DocPubSub over
// these (see ipc-crdt.ts in the docs feature). Main answers from a snapshot on
// disk and does the cloud work behind it, so opening a document doesn't wait on
// the network.
//
// Yjs state is binary. It crosses IPC as a Buffer (a Uint8Array does not
// survive the structured clone intact) and is converted back on each side.
const crdt: CrdtPort = {
  load: async (docId) => {
    const bytes: Uint8Array | null = await ipcRenderer.invoke("crdt:load", { docId });
    return bytes ? new Uint8Array(bytes) : null;
  },
  /** Whether main already holds this document's snapshot on disk. */
  has: (docId) => ipcRenderer.invoke("crdt:has", { docId }),
  save: (docId, bytes) => ipcRenderer.invoke("crdt:save", { docId, bytes }),
  /**
   * Hear when main has refreshed a document from the cloud. Live edits do NOT
   * come this way — they arrive on the renderer's own Realtime connection; this
   * is the catch-up for a snapshot served from a stale cache.
   */
  onUpdate: (docId, cb) => {
    const off = on<Uint8Array>(`crdt:update:${docId}`, (update) => cb(new Uint8Array(update)));
    return () => {
      off();
      ipcRenderer.send("crdt:release", { docId });
    };
  },
  /**
   * Where a cached document's cloud refresh has got to: "start" while one is in
   * flight, "done" when it landed, "failed" when it could not be fetched.
   *
   * The renderer uses this to admit it is showing a cached copy. Measured on this
   * machine the wait is ~400-600 ms warm and ~1.5 s cold — and unbounded when the
   * request fails, which used to be swallowed entirely.
   */
  onRefresh: (docId, cb) => on(`crdt:refresh:${docId}`, cb),
};

const agent: AgentBridge = {
  /**
   * Call this when the user opens the agent panel. Resolves `{ ready: true }` if
   * Claude is connected; otherwise the sign-in window opens and it resolves
   * `{ ready: false }` — don't open the panel, the user is being asked to sign in.
   */
  ensureReady: () => ipcRenderer.invoke("claude-auth:ensure"),
  /**
   * Open a local coding agent (claude-code / codex / cursor / claude-desktop) in
   * the vault's mounted folder. CLI agents open in a terminal; editor apps via
   * `open -a`. Reports a refusal (e.g. the vault isn't mounted here) natively.
   */
  open: (agentId, vaultId, docId): Promise<Outcome> =>
    ipcRenderer.invoke("markbase:open-agent", { agentId, vaultId, docId }),
  // Native agent chat: start a Claude turn in a vault, stream chunks back. The
  // chunk is a StreamChunk.
  chat: {
    start: (sessionId, params): Promise<Outcome> =>
      ipcRenderer.invoke("agent-chat:start", { sessionId, ...params }),
    cancel: (sessionId) => ipcRenderer.send("agent-chat:cancel", { sessionId }),
    /** The panel is closing for good — end its CLI. */
    close: (sessionId) => ipcRenderer.send("agent-chat:close", { sessionId }),
    onChunk: (sessionId, cb) => on<StreamChunk>(`agent-chat:chunk:${sessionId}`, cb),
    onEnd: (sessionId, cb) => on<Outcome>(`agent-chat:end:${sessionId}`, cb),
  },
  // Persisted sessions: the `.chat/` index (doc links + titles) and the
  // transcript read back from the SDK's ~/.claude store on reopen.
  sessions: {
    list: (vaultId, docId): Promise<ChatSessionMeta[]> =>
      ipcRenderer.invoke("agent-chat:sessions:list", { vaultId, docId }),
    get: (vaultId, id): Promise<ChatSessionMeta | null> =>
      ipcRenderer.invoke("agent-chat:sessions:get", { vaultId, id }),
    save: (vaultId, meta) => ipcRenderer.invoke("agent-chat:sessions:save", { vaultId, meta }),
    delete: (vaultId, id) => ipcRenderer.invoke("agent-chat:sessions:delete", { vaultId, id }),
    transcript: (vaultId, sessionId): Promise<ChatTurn[] | null> =>
      ipcRenderer.invoke("agent-chat:transcript", { vaultId, sessionId }),
  },
  pty: {
    start: (ptyId, agentId, vaultId, cols, rows): Promise<Outcome> =>
      ipcRenderer.invoke("markbase:pty-start", { ptyId, agentId, vaultId, cols, rows }),
    write: (ptyId, data) => ipcRenderer.send("markbase:pty-input", { ptyId, data }),
    resize: (ptyId, cols, rows) => ipcRenderer.send("markbase:pty-resize", { ptyId, cols, rows }),
    kill: (ptyId) => ipcRenderer.send("markbase:pty-kill", { ptyId }),
    onData: (ptyId, cb) => on<string>(`markbase:pty-data:${ptyId}`, cb),
    onExit: (ptyId, cb) => on<number>(`markbase:pty-exit:${ptyId}`, cb),
  },
};

// The Shared Vault's forks (docs/shared-vault.md). Main runs the daemon that
// holds them; the surface lists them, compares the two texts, and takes one of
// the ways out. Both texts come from main — the cloud's from the replica's
// shadow, the local one from the file — so the comparison needs no network.
const forks: ForksPort = {
  list: () => ipcRenderer.invoke("markbase:shared-forks"),
  compare: (docId) => ipcRenderer.invoke("markbase:fork-compare", { docId }),
  discard: (docId) => ipcRenderer.invoke("markbase:fork-discard", { docId }),
  keepCopy: (docId, vaultId) => ipcRenderer.invoke("markbase:fork-keep-copy", { docId, vaultId }),
  onChanged: (cb) => on<LocalFork[]>("markbase:shared-forks-changed", cb),
};

/**
 * The Tabs menu's commands (New Tab, Close Tab, Back, …). Menu accelerators fire
 * before the page sees the key — which is how ⌘W closes a tab, not the window —
 * so the menu forwards them here by name.
 */
const tabs: TabMenuPort = {
  onCommand: (cb) => on<string>("markbase:tab-command", cb),
};

// ---- Which window this is ----------------------------------------------------

const KIND_ARG = "--markbase-window=";
const SUPABASE_URL_ARG = "--markbase-supabase-url=";
const SUPABASE_KEY_ARG = "--markbase-supabase-key=";

/** One `--name=value` off argv, or "" when main did not pass it. */
function argValue(prefix: string): string {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function windowKind(): WindowKind {
  const arg = process.argv.find((a) => a.startsWith(KIND_ARG));
  const kind = arg?.slice(KIND_ARG.length);
  switch (kind) {
    case "dashboard":
    case "viewer":
    case "onboarding":
      return kind;
  }
  // Every BrowserWindow in main.ts names its kind. One that does not is a
  // mistake there, and a page with no bridge says so (renderer/shell.ts)
  // rather than quietly getting everything.
  throw new Error(`preload: no window kind in argv (${KIND_ARG}<kind> missing)`);
}

function bridgeFor(kind: WindowKind): MarkbaseBridge {
  switch (kind) {
    case "dashboard":
      return {
        kind,
        isDesktop: true,
        api,
        auth,
        openExternal,
        vaults,
        crdt,
        agent,
        tabs,
        forks,
        instance,
        onOpenSettings: (cb) => on<void>("markbase:open-settings", () => cb()),
        defaultOpener,
        agents,
      };
    case "viewer":
      return { kind, isDesktop: true, openExternal, file };
    case "onboarding":
      return { kind, isDesktop: true, openExternal, claude, instance };
  }
}

contextBridge.exposeInMainWorld("markbase", bridgeFor(windowKind()));

// The Supabase project this process runs against (main.ts windowArgs). The
// pages' bundle reads these where the website's reads its NEXT_PUBLIC_ pair —
// see vite.config.mts — so one build of this app joins whichever instance the
// machine was pointed at. Public values, same as every browser gets.
contextBridge.exposeInMainWorld("__MARKBASE_SUPABASE_URL__", argValue(SUPABASE_URL_ARG));
contextBridge.exposeInMainWorld("__MARKBASE_SUPABASE_KEY__", argValue(SUPABASE_KEY_ARG));
