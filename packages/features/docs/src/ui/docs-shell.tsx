"use client";

import { api } from "@markbase/protocol/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { readLocal, readLocalJson, writeLocal, writeLocalJson } from "./local-store";
import { useClientValue } from "./client-value";
import { useNavigation } from "@markbase/ui/navigation";
import { DocsRoutingProvider, type DocsRouting } from "./routing";
import {
  actionForUrl,
  activeDocId,
  activeTab,
  canGoBack,
  canGoForward,
  currentEntry,
  historyModeFor,
  initialTabs,
  popAction,
  reduceTabs,
  restoreTabs,
  serializeTabs,
  type DocTabAction,
  type DocTabsState,
  type OpenIntent,
} from "@markbase/docs/workspace-tabs";
import { DocsSidebar } from "./docs-sidebar";
import { NewVaultModal, type VaultMeta } from "./new-vault-modal";
import { VaultEmptyState, VaultLoadError } from "./vault-empty-state";
import { SHARED_SCOPE, isSharedScope } from "./scope";
import { DocsStoreProvider, preloadDocWorkspaces } from "./docs-store";
import { DocsWorkspace } from "./docs-workspace";
import { DocsHeader } from "./docs-header";
import { fetchDocList, refreshDocList, invalidateDocLists } from "./doc-list-fetch";
import { cachedGet, invalidateUrl } from "@markbase/ui/app-cache";
import { usePrompt } from "@markbase/ui/prompt-dialog";
import { AgentLauncherProvider } from "./agent-launcher";
import { useIsDesktop } from "@markbase/ui/use-is-desktop";
import { useIsMobile } from "@markbase/ui/use-mobile";
import { DocsPortsProvider, type DocsPorts, type VaultsPort } from "./ports";

/** How long a first-sync banner may go without a progress tick before it is
 *  taken as abandoned. A real pass reports per file, many times a minute. */
const STALE_PROGRESS_MS = 20_000;

const FOCUS_KEY = "mb:focusedVault";
const VAULTS_URL = "/api/v1/vaults";
/** Don't re-ask the server for the doc list more often than this on focus. */
const FOCUS_REFRESH_MS = 60_000;
/** Let the doc you opened render before warming the other open tabs. */
const PRELOAD_DELAY_MS = 1_500;
/** The tabs (workspaces, each with its own history) — per device and per vault. */
const tabsKey = (vaultId: string) => `mb:tabs:v2:${vaultId}`;
/** The one-tab-per-document list the workspaces replaced. Read once, to migrate. */
const legacyOpenKey = (vaultId: string) => `mb:open:${vaultId}`;
/** Whether the file sidebar is showing — remembered per device. */
const SIDEBAR_KEY = "mb:docsSidebarOpen";

/** Commands the desktop app's Tabs menu sends — see onTabCommand. */
const TAB_COMMANDS = [
  "newTab",
  "closeTab",
  "reopenClosedTab",
  "back",
  "forward",
  "nextTab",
  "prevTab",
] as const;
type TabCommand = (typeof TAB_COMMANDS)[number];
function isTabCommand(s: string): s is TabCommand {
  return (TAB_COMMANDS as readonly string[]).includes(s);
}

/** A fresh tab id. */
function newTabId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The vaults mounted on this machine, from the desktop's local registry — no
 * server involved. Empty in a browser (no bridge) and if the bridge fails.
 */
/**
 * Vaults deliberately unmounted on this machine, which the app hides.
 *
 * Empty in a browser and on older desktop builds — nothing hidden, which is
 * what those clients have always done. An unmount is a statement about THIS
 * machine, so the filtering is local: the same account on another Mac is
 * unaffected, and the cloud list itself never changes.
 */
async function readHiddenVaults(vaults: VaultsPort | null): Promise<Set<string>> {
  try {
    return new Set((await vaults?.unmounted()) ?? []);
  } catch {
    return new Set();
  }
}

async function readLocalVaults(vaults: VaultsPort | null): Promise<VaultMeta[]> {
  try {
    const mounted = (await vaults?.mounted()) ?? [];
    return mounted.map((v) => ({
      id: v.vaultId,
      // Older desktop builds don't send the name; the folder's is the next best.
      name: v.name ?? v.dir.split("/").filter(Boolean).pop() ?? v.vaultId,
    }));
  } catch {
    return [];
  }
}

/** Our position in the browser's history, stamped on every entry we write. */
function seqOf(state: { mbSeq?: number } | null): number | null {
  return typeof state?.mbSeq === "number" ? state.mbSeq : null;
}

type WikiDoc = { id: string; title: string; path: string | null };

/** The last path segment, minus a trailing `.md`. */
function baseNoExt(p: string): string {
  const noExt = p.replace(/\.md$/i, "");
  const slash = noExt.lastIndexOf("/");
  return slash >= 0 ? noExt.slice(slash + 1) : noExt;
}

/**
 * Resolve a `[[wiki target]]` to a vault doc — like Obsidian: an exact
 * vault-relative path first (`[[learning/01-foo]]`), then a bare filename
 * anywhere (`[[01-foo]]`), then a title. Case-insensitive; `.md` optional.
 */
function resolveWikiTarget(target: string, docs: WikiDoc[]): WikiDoc | null {
  const t = target.replace(/\.md$/i, "").trim().toLowerCase();
  if (!t) return null;
  const noExt = (p: string) => p.replace(/\.md$/i, "").toLowerCase();
  return (
    docs.find((d) => d.path && noExt(d.path) === t) ??
    docs.find((d) => d.path && baseNoExt(d.path).toLowerCase() === t) ??
    docs.find((d) => d.title.toLowerCase() === t) ??
    null
  );
}

/**
 * Resolve a file REFERENCE from the agent chat (or a wiki-link) to a vault doc.
 * A superset of `resolveWikiTarget`: also matches an absolute path by its
 * vault-relative suffix (the agent's tool calls use absolute paths), then falls
 * back to bare-filename / title resolution.
 */
function resolveFileRef(ref: string, docs: WikiDoc[]): WikiDoc | null {
  const clean = ref.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!clean) return null;
  const target = clean.replace(/\.md$/i, "").toLowerCase();
  const byPath = docs.find((d) => {
    if (!d.path) return false;
    const p = d.path.replace(/\.md$/i, "").toLowerCase();
    return target === p || target.endsWith(`/${p}`);
  });
  return byPath ?? resolveWikiTarget(baseNoExt(clean), docs);
}

/**
 * Orchestrates the documents surface's navigation: the documentation sidebar
 * (tree + vault switcher), the vault focus, and the tabs. The working surface
 * itself — tab strip, active doc, and panel — is DocsWorkspace.
 *
 * Tabs are workspaces, Obsidian's model (see @markbase/docs/workspace-tabs):
 * opening a document navigates the tab you're in and adds to its history; a new
 * tab is asked for with ⌘/Ctrl-click, middle-click or ⌘T.
 *
 * Focus (which vault) lives in the URL as `?vault=` so it's linkable and
 * survives reload; the tabs are per-device (localStorage), keyed by vault. The
 * URL shows the active tab's document. `children` is the per-route server page
 * (an inert placeholder — the workspace renders client-side), accepted but not
 * rendered.
 */
export function DocsShell({
  userId,
  userName,
  routing,
  ports,
}: {
  children: React.ReactNode;
  userId: string | null;
  userName: string;
  /** How this shell spells document URLs. See ./routing. */
  routing: DocsRouting;
  /** What this shell's machine can do for the surface. See ./ports. */
  ports: DocsPorts;
}) {
  const { docUrl, idFromPath } = routing;
  const { push, refresh, pathname, searchParams } = useNavigation();
  const isDesktop = useIsDesktop();

  const [vaults, setVaults] = useState<VaultMeta[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(true);
  // The vault list couldn't be fetched AND nothing is mounted here to show
  // instead. Distinct from "no vaults": that gets onboarding, this gets a retry.
  const [vaultsError, setVaultsError] = useState(false);
  // Bumped by "Try again" to re-run the vault load.
  const [vaultsNonce, setVaultsNonce] = useState(0);
  // Whether any docs are shared WITH this user — drives whether the empty state
  // (0 vaults) still needs to offer the "Shared with me" view.
  const [sharedExists, setSharedExists] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  // A confirmed-empty account gets the first-vault dialog straight away, once:
  // the screen behind it has one thing to do, and asking the person to click a
  // button to be asked for a name was a step with nothing in it. Dismissing it
  // leaves the screen, whose button opens it again.
  const noVaults = !loadingVaults && vaults.length === 0 && !sharedExists;
  const [promptedFirstVault, setPromptedFirstVault] = useState(false);
  useEffect(() => {
    if (!noVaults || promptedFirstVault) return;
    setPromptedFirstVault(true);
    setModalOpen(true);
  }, [noVaults, promptedFirstVault]);
  const [creating, setCreating] = useState(false);
  // The focused vault's docs (id + path + title) — the lookup table for resolving
  // `[[wiki-links]]` to a doc to open. Kept fresh by the title-sync effect below.
  const [vaultDocs, setVaultDocs] = useState<WikiDoc[]>([]);
  // The same docs' titles, readable from callbacks that must not change identity
  // every time the list does.
  const titlesRef = useRef<Map<string, string>>(new Map());
  // Bumped to re-fetch the tree IN PLACE (keeps folders expanded) when the vault's
  // doc set changes — including files the vault daemon syncs up from disk.
  const ask = usePrompt();
  const [treeVersion, setTreeVersion] = useState(0);
  /** The focused vault's first sync, while it runs. Desktop only. */
  const [syncing, setSyncing] = useState<{ done: number; total: number } | null>(null);
  // Signature of the last-seen doc set, to detect real changes vs. a no-op poll.
  const vaultSigRef = useRef<string>("");
  // Whether the documentation sidebar is shown; collapsing it gives the workspace
  // the full width. Per-device (localStorage).
  // Open unless this browser remembers otherwise. Through useClientValue so the
  // server renders the open sidebar and the browser corrects it at hydration,
  // rather than an effect closing it a commit later; `toggled` is this session's
  // answer once there is one.
  const storedSidebarOpen = useClientValue(() => readLocal(SIDEBAR_KEY) !== "0", true);
  const [toggled, setToggled] = useState<boolean | null>(null);
  // On a narrow screen the list starts closed whatever this browser remembers:
  // beside the app's icon rail a 16rem list leaves a phone-width window a
  // document column a few characters wide. The header's toggle still opens
  // it, and that choice holds for the session like any other.
  const narrow = useIsMobile();
  const sidebarOpen = toggled ?? (narrow ? false : storedSidebarOpen);
  const setSidebarOpen = setToggled;
  // The sidebar's two states: the file tree, or a search across the vault.
  const [searching, setSearching] = useState(false);

  // The tabs. They start from the URL (a deep link renders its document at once)
  // and are replaced by the stored set once mounted.
  const [tabs, setTabs] = useState<DocTabsState>(() => initialTabs(idFromPath(pathname)));
  // The same state, readable synchronously: two actions in one tick (a burst of
  // middle-clicks, a shortcut mid-click) must each see the other's result, and
  // the URL and storage are written outside any React updater — pushState from
  // inside one updates the App Router mid-render ("Cannot update `Router`").
  const tabsRef = useRef<DocTabsState>(tabs);
  // Which vault `tabs` belongs to. Null until the first restore, so nothing
  // writes a vault's tabs — or the URL — before they've been read.
  const tabsVaultRef = useRef<string | null>(null);
  const [tabsVault, setTabsVault] = useState<string | null>(null);
  // Our position among the browser-history entries we've written: how a
  // popstate tells Back from Forward.
  const seqRef = useRef(0);
  const activeId = activeDocId(tabs);

  const urlVault = searchParams.get("vault");
  // Focus follows the URL; when it's absent we resolve one once the vaults load.
  const focusedVaultId =
    urlVault ?? (vaults.length ? vaults[0].id : sharedExists ? SHARED_SCOPE : null);
  const sharedFocused = isSharedScope(focusedVaultId);

  /**
   * Show `url` in the address bar — as a new history entry (a step within a tab,
   * which Back undoes) or in place. Through pushState, not the router: the
   * surface is one route, and a router navigation made every switch wait for an
   * App-Router RSC round trip. Next patches pushState, so the pathname and
   * query the port reports still hold the new value.
   */
  const writeUrl = useCallback((url: string, mode: "push" | "replace") => {
    if (mode === "push") {
      seqRef.current += 1;
      window.history.pushState({ mbSeq: seqRef.current }, "", url);
    } else {
      window.history.replaceState({ mbSeq: seqRef.current }, "", url);
    }
  }, []);

  /** Make `next` the tabs: state, storage, and the address bar. */
  const commit = useCallback(
    (next: DocTabsState, mode: "push" | "replace") => {
      const vault = tabsVaultRef.current;
      if (next !== tabsRef.current) {
        tabsRef.current = next;
        setTabs(next);
        if (vault) writeLocalJson(tabsKey(vault), serializeTabs(next));
      }
      // Before this vault's tabs are restored, the URL is the only record of
      // what was asked for — leave it alone.
      if (!vault) return;
      const url = docUrl(activeDocId(next), vault);
      if (mode === "push" || url !== window.location.pathname + window.location.search) {
        writeUrl(url, mode);
      }
    },
    [writeUrl]
  );

  /**
   * Apply a tab action. Only a step within the tab you're in — opening a
   * document there — adds a browser-history entry: Back and Forward move through
   * the tab's history. Switching, opening or closing a tab rewrites the current
   * entry instead, so Back never reopens a tab you closed. `record: false` is for
   * a navigation that already made its own entry (a push() elsewhere).
   */
  const act = useCallback(
    (action: DocTabAction, record = true) => {
      const prev = tabsRef.current;
      const next = reduceTabs(prev, action);
      commit(next, historyModeFor(prev, next, action, record));
    },
    [commit]
  );

  const titleOf = useCallback((id: string) => titlesRef.current.get(id) ?? "", []);

  // Browser Back/Forward move through the active tab's history. The entry the
  // browser lands on may belong to another tab (you switched after navigating),
  // so we don't trust its URL — we step the tab and show where the tab is.
  useEffect(() => {
    const here = seqOf(window.history.state as { mbSeq?: number } | null);
    if (here !== null) seqRef.current = here;
    else window.history.replaceState({ mbSeq: seqRef.current }, "", window.location.href);

    const onPop = (e: PopStateEvent) => {
      const seq = seqOf(e.state as { mbSeq?: number } | null);
      if (seq === null) return; // not an entry we wrote
      const from = seqRef.current;
      seqRef.current = seq;
      // Back into another vault is a vault switch: the focus effect restores that
      // vault's tabs. Stepping this vault's tab as well would be wrong.
      if (new URLSearchParams(window.location.search).get("vault") !== tabsVaultRef.current) return;
      const cur = tabsRef.current;
      const move = popAction(from, seq);
      commit(move ? reduceTabs(cur, move) : cur, "replace");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [commit]);

  useEffect(() => {
    let cancelled = false;
    let networkAnswered = false;
    // A vault mounted on this machine exists whether or not the server (or its
    // database) is up, so paint those from the local registry at once — the same
    // disk-first order the tree uses. The network's list replaces them when it
    // lands, since only it knows cloud-only vaults.
    const local = readLocalVaults(ports.vaults);
    // Read alongside the list, not after it: the filter has to be ready when the
    // network answers, or a vault flashes into the sidebar and back out again.
    const hidden = readHiddenVaults(ports.vaults);
    void local.then((mounted) => {
      if (cancelled || networkAnswered || mounted.length === 0) return;
      // No filtering needed here: these ARE the mounted vaults, and a mounted
      // vault cannot be tombstoned — mounting clears it.
      setVaults(mounted);
      setLoadingVaults(false);
    });
    Promise.all([
      // Cached: the vault list is the same on every visit to the surface, and
      // re-fetching it was delaying the tree (which waits on the focused vault)
      // by a round trip each time. Vault create/rename/delete invalidate it.
      cachedGet<{ vaults?: VaultMeta[] }>(VAULTS_URL)
        .then(async (d) => {
          networkAnswered = true;
          // The cloud knows every vault the ACCOUNT has; this machine knows
          // which of them it was told to stop syncing. A vault unmounted here
          // on purpose leaves the app, and stays gone across reloads because
          // the record is in the registry rather than in this component.
          const drop = await hidden;
          if (!cancelled) setVaults((d.vaults ?? []).filter((v) => !drop.has(v.id)));
        })
        .catch(async () => {
          // A failed request is not an empty account. Swallowing it here used to
          // leave the list at [] and show "Create your first vault" whenever the
          // database was down. Keep the mounted vaults; with none, say we couldn't
          // load rather than offering onboarding.
          const mounted = await local;
          if (cancelled) return;
          if (mounted.length) setVaults(mounted);
          else setVaultsError(true);
        }),
      // Just needs to know whether ANY doc is shared with the user, so the empty
      // state can still route them to "Shared with me".
      fetchDocList<{ docs?: { id: string }[] }>("/api/v1/docs?scope=shared")
        .then((d) => {
          if (!cancelled) setSharedExists((d.docs ?? []).length > 0);
        })
        .catch(() => {}),
    ]).finally(() => {
      if (!cancelled) setLoadingVaults(false);
    });
    return () => {
      cancelled = true;
    };
  }, [vaultsNonce, ports.vaults]);

  const retryVaults = useCallback(() => {
    setVaultsError(false);
    setLoadingVaults(true);
    setVaultsNonce((n) => n + 1);
  }, []);

  // No ?vault in the URL but we have somewhere to focus: adopt the last-focused
  // (or first vault, or Shared with me) and put it in the URL so links and
  // reloads land on the same tree.
  useEffect(() => {
    if (loadingVaults || urlVault) return;
    if (vaults.length === 0 && !sharedExists) return;
    let preferred = vaults.length ? vaults[0].id : SHARED_SCOPE;
    const stored = readLocal(FOCUS_KEY);
    const valid =
      stored &&
      ((stored === SHARED_SCOPE && sharedExists) || vaults.some((v) => v.id === stored));
    if (valid && stored) preferred = stored;
    // In place: this only records which vault is focused.
    writeUrl(docUrl(activeId, preferred), "replace");
  }, [loadingVaults, urlVault, vaults, sharedExists, activeId, writeUrl]);

  // Restore the focused vault's tabs, remembering the focus.
  // The tabs are per device AND per vault, so they cannot be read during render
  // — the server has no localStorage, and these tabs ARE rendered, so the two
  // passes would disagree and hydration would warn. Reading after mount is the
  // constraint, not a preference.
  useEffect(() => {
    if (!focusedVaultId) return;
    writeLocal(FOCUS_KEY, focusedVaultId);
    // Arriving on a document (a deep link, a reload) shows it — in the tab that
    // already has it, or a new one, never over what another tab was showing.
    const state = restoreTabs({
      stored: readLocalJson(tabsKey(focusedVaultId)),
      legacy: readLocalJson(legacyOpenKey(focusedVaultId)),
      urlDocId: idFromPath(window.location.pathname),
      titles: titlesRef.current,
      newTabId,
    });
    tabsVaultRef.current = focusedVaultId;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTabsVault(focusedVaultId);
    commit(state, "replace");
    // Fetch the content of every tab's document now, rather than when its tab is
    // first clicked. They're all going to be read, and the cache holds them for
    // the life of the app — so this is the one time we pay for them.
    //
    // Held back a moment, and skipping the active doc: the document you're
    // actually looking at is loaded by the workspace, and it should not have to
    // share the connection with a dozen background loads to render.
    const active = activeDocId(state);
    const others = state.tabs
      .map((t) => currentEntry(t)?.docId)
      .filter((id): id is string => !!id && id !== active);
    const timer = setTimeout(() => preloadDocWorkspaces(others), PRELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusedVaultId, commit]);

  // Navigations that didn't come through the tabs — a push() elsewhere on
  // the page (deleting a subtab hands you its sibling), a link into the surface.
  // A document opens in the tab you're in; an index URL just shows the active
  // tab again. Reads the address bar rather than `pathname`: after a Back, the
  // popstate handler has already rewritten it, and `pathname` may lag behind.
  useEffect(() => {
    if (!tabsVault) return;
    const urlDoc = idFromPath(window.location.pathname);
    if (urlDoc === activeDocId(tabsRef.current)) return;
    const action = actionForUrl(tabsRef.current, urlDoc, urlDoc ? titleOf(urlDoc) : "", newTabId());
    if (action) act(action, false);
    else commit(tabsRef.current, "replace");
  }, [pathname, tabsVault, act, commit, titleOf]);

  // A mounting vault adopts one document per network round trip, so the list the
  // tree fetched at mount ("Nothing in this vault yet") stayed on screen for the
  // whole run. Nothing polled: the only refresh was window focus. So follow the
  // daemon instead — it knows exactly how far it has got.
  useEffect(() => {
    const vaults = ports.vaults;
    if (!vaults || !focusedVaultId) return;
    let last = 0;
    // A pass that stops before its final tick — the app quit mid-sync, or the
    // vault's lock went to another process — leaves the last count on screen
    // with nothing to clear it. A banner that hears nothing for a while comes
    // down on its own.
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const off = vaults.onProgress((p) => {
      if (p.vaultId !== focusedVaultId) return;
      const done = p.done >= p.total;
      setSyncing(done ? null : { done: p.done, total: p.total });
      clearTimeout(quiet);
      if (!done) quiet = setTimeout(() => setSyncing(null), STALE_PROGRESS_MS);
      // Re-read the list as work lands, but not once per file: a document costs
      // seconds to adopt, so a few seconds between refreshes still feels live.
      const now = Date.now();
      if (done || now - last > 3000) {
        last = now;
        invalidateUrl(`/api/v1/docs?vault=${encodeURIComponent(focusedVaultId)}`);
        setTreeVersion((v) => v + 1);
      }
    });
    return () => {
      off();
      clearTimeout(quiet);
      // The count belongs to the vault it was heard for. It used to survive a
      // switch, so "Syncing this folder — 32 of 34 files" sat under a vault
      // with one file in it.
      setSyncing(null);
    };
  }, [focusedVaultId, ports.vaults]);

  // Keep the tree, tab titles, and the wiki-link lookup honest with the focused
  // vault. Fetch on mount/vault-change and whenever the window regains focus — so
  // a file added on disk (synced up by the vault daemon) or on another device
  // appears when you tab back, no manual refresh. State only changes when the doc
  // set actually did (compared by signature), so a no-op refocus doesn't re-render.
  useEffect(() => {
    if (!focusedVaultId) return;
    // A new focus is a fresh doc set — baseline it without reloading the tree.
    vaultSigRef.current = "";
    let cancelled = false;
    const url = sharedFocused
      ? "/api/v1/docs?scope=shared"
      : `/api/v1/docs?vault=${encodeURIComponent(focusedVaultId)}`;
    // `refresh` means "the doc set may have changed underneath us" (a focus/
    // visibility event); the first call just reads the cache. Refreshes are
    // throttled: on the desktop, clicking the title-bar drag region fires a
    // window focus event, and that must not turn every click on the tab strip
    // into a reload of the whole document list.
    const load = (refresh = false) => {
      const p = refresh
        ? refreshDocList<{ docs?: WikiDoc[] }>(url, FOCUS_REFRESH_MS)
        : fetchDocList<{ docs?: WikiDoc[] }>(url);
      p
        .then((d) => {
          if (cancelled) return;
          const docs = d.docs ?? [];
          const sig = docs
            .map((x) => `${x.id}:${x.path ?? ""}:${x.title}`)
            .sort()
            .join("|");
          if (sig !== vaultSigRef.current) {
            setVaultDocs(docs);
            // Not on the first fetch for a vault (baseline) — only a real change,
            // so the tree picks up added/renamed/moved files in place.
            if (vaultSigRef.current) setTreeVersion((v) => v + 1);
            vaultSigRef.current = sig;
            titlesRef.current = new Map(docs.map((x) => [x.id, x.title]));
            const next = reduceTabs(tabsRef.current, { type: "retitle", titles: titlesRef.current });
            if (next !== tabsRef.current) commit(next, "replace");
          }
        })
        .catch(() => {});
    };
    load();
    // Refresh when you come back to the window (Electron focus, or a browser tab
    // becoming visible again).
    const onFocus = () => load(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    // On the desktop, the shell tells us the moment a file becomes a document —
    // it is the process that adopted it. Waiting for a focus event meant a folder
    // an agent had just written stayed invisible until you clicked away and back.
    //
    // The throttle above is deliberately bypassed: this fires because something
    // ACTUALLY changed, not because a window event might mean it did. Bypassing
    // the cache is the point — refreshDocList would serve the copy that predates
    // the change.
    const offDocsChanged = ports.vaults?.onDocsChanged((p) => {
      if (p.vaultId !== focusedVaultId) return; // another vault; nothing on screen
      invalidateDocLists();
      load();
    });

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      offDocsChanged?.();
    };
  }, [focusedVaultId, sharedFocused, commit, ports.vaults]);

  const focus = useCallback(
    (id: string) => {
      writeLocal(FOCUS_KEY, id);
      // A real history entry, so Back returns to the vault you came from. The
      // restore effect above then shows this vault's tabs.
      writeUrl(docUrl(null, id), "push");
    },
    [writeUrl]
  );

  const openDoc = useCallback(
    (id: string, title: string, intent: OpenIntent = "current") => {
      act({ type: "open", docId: id, title, intent, newTabId: newTabId() });
    },
    [act]
  );

  // Follow a `[[wiki-link]]`: resolve the target name against the focused vault's
  // docs and open it. Unresolved names (a note that doesn't exist yet) are a
  // no-op — nothing to open.
  const openWikiLink = useCallback(
    (target: string, intent: OpenIntent = "current") => {
      const hit = resolveFileRef(target, vaultDocs);
      if (hit) openDoc(hit.id, hit.title, intent);
    },
    [vaultDocs, openDoc]
  );

  // Stable, because the workspace and its memoised slots receive them.
  const selectTab = useCallback((tabId: string) => act({ type: "select", tabId }), [act]);
  const closeTab = useCallback((tabId: string) => act({ type: "close", tabId }), [act]);
  const closeOtherTabs = useCallback(
    (tabId: string) => act({ type: "closeOthers", tabId }),
    [act]
  );
  const closeAllTabs = useCallback(() => act({ type: "closeAll" }), [act]);
  const pinTab = useCallback(
    (tabId: string, pinned: boolean) => act({ type: "pin", tabId, pinned }),
    [act]
  );
  const newTab = useCallback(() => act({ type: "newTab", tabId: newTabId() }), [act]);
  const goBack = useCallback(() => act({ type: "back" }), [act]);
  const goForward = useCallback(() => act({ type: "forward" }), [act]);
  const closeActiveTab = useCallback(() => {
    const id = tabsRef.current.activeTabId;
    if (id) act({ type: "close", tabId: id });
  }, [act]);

  const runTabCommand = useCallback(
    (command: TabCommand) => {
      switch (command) {
        case "newTab":
          return newTab();
        case "closeTab":
          return closeActiveTab();
        case "reopenClosedTab":
          return act({ type: "reopenClosed" });
        case "back":
          return goBack();
        case "forward":
          return goForward();
        case "nextTab":
          return act({ type: "selectRelative", delta: 1 });
        case "prevTab":
          return act({ type: "selectRelative", delta: -1 });
      }
    },
    [act, newTab, closeActiveTab, goBack, goForward]
  );

  // The desktop app's Tabs menu. Its accelerators (⌘T, ⌘W, ⌘⇧T, ⌘⌥←/→, ⌃Tab)
  // are claimed by the menu ahead of the page, which is how ⌘W closes a tab
  // rather than the window; they arrive here as commands.
  useEffect(
    () =>
      ports.tabMenu?.onCommand((command) => {
        if (isTabCommand(command)) runTabCommand(command);
      }),
    [runTabCommand, ports.tabMenu]
  );

  // The keys a browser lets us have. ⌘⌥← / ⌘⌥→ (Ctrl+Alt elsewhere) step back and
  // forward in the tab — Obsidian's keys; the desktop menu owns those there.
  // ⌘1–⌘8 pick a tab by position and ⌘9 the last, where the browser doesn't keep
  // them for its own tabs (i.e. the desktop app).
  useEffect(() => {
    const menuOwnsKeys = ports.tabMenu !== null;
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (menuOwnsKeys) return;
        e.preventDefault();
        e.stopPropagation();
        runTabCommand(e.key === "ArrowLeft" ? "back" : "forward");
        return;
      }
      if (!e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const n = Number(e.key);
        act({ type: "selectIndex", index: n === 9 ? Number.MAX_SAFE_INTEGER : n - 1 });
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [act, runTabCommand, ports.tabMenu]);

  // A mouse's back/forward buttons. A browser already turns them into history
  // navigation (handled by popstate above); the desktop app does nothing with
  // them unless we do.
  useEffect(() => {
    if (!isDesktop) return;
    function onUp(e: MouseEvent) {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      runTabCommand(e.button === 3 ? "back" : "forward");
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [isDesktop, runTabCommand]);

  const createDoc = useCallback(
    async (path?: string) => {
      // Shared-with-me has no vault to create into.
      if (creating || isSharedScope(focusedVaultId)) return;
      setCreating(true);
      try {
        const res = await api.request("/api/v1/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Untitled",
            ...(path ? { path } : {}),
            vault_id: focusedVaultId ?? undefined,
          }),
        });
        if (res.ok) {
          const { doc } = await res.json();
          // The cached lists no longer describe this vault — drop them so the
          // tree's next read goes to the server and shows the new document.
          invalidateDocLists();
          setTreeVersion((v) => v + 1);
          openDoc(doc.id, doc.title ?? "Untitled");
        }
      } finally {
        setCreating(false);
      }
    },
    [creating, focusedVaultId, openDoc]
  );

  const newDoc = useCallback(() => void createDoc(), [createDoc]);

  const newFolder = useCallback(async () => {
    if (isSharedScope(focusedVaultId)) return;
    // Not window.prompt: Electron THROWS on it, so this whole handler died and
    // the button silently did nothing in the desktop app.
    const name = await ask({ title: "New folder", placeholder: "Name", confirmLabel: "Create" });
    if (!name) return;
    if (name.includes("/") || name.includes("\\")) {
      alert("A folder name can't contain a path separator.");
      return;
    }
    // Paths carry the folder structure, so a folder becomes real once a doc is in it.
    void createDoc(`${name}/Untitled.md`);
  }, [ask, createDoc, focusedVaultId]);

  const setSidebar = useCallback(
    (open: boolean) => {
      setSidebarOpen(open);
      writeLocal(SIDEBAR_KEY, open ? "1" : "0");
    },
    [setSidebarOpen]
  );

  // Stable, because OpenDocTabs receives it through the memoised workspace.
  const showSidebar = useCallback(() => setSidebar(true), [setSidebar]);

  /**
   * Cmd/Ctrl+B toggles the sidebar — the same key the app's other sidebars use.
   * Cmd/Ctrl+\ does the same thing, for the muscle memory Notion and VS Code
   * built.
   *
   * Collapsed is a REMEMBERED state, so a sidebar closed once stays closed on
   * every launch after it, and the only way back was one small button in the
   * corner. Miss it and the documents are gone, with the flag sitting in a
   * localStorage the desktop app gives you no easy console to clear.
   *
   * This first shipped with an exception — leave Cmd+B alone while the caret is
   * in the editor, where it means bold — and the exception WAS the bug. The
   * caret is in the editor essentially always, so a shortcut for reaching the
   * sidebar that only works while you are not writing is one that does not work.
   * Bold keeps its toolbar button and its `**markdown**`; the sidebar had
   * neither.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "\\" && e.key.toLowerCase() !== "b") return;
      e.preventDefault();
      // And stopPropagation: the editor binds Cmd+B on its own node, so
      // preventDefault alone would open the sidebar AND bold the selection.
      e.stopPropagation();
      setSidebar(!sidebarOpen);
    }
    // Capture phase — ahead of the editor's handler rather than after it has
    // already acted.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sidebarOpen, setSidebar]);

  // Stable, because the sidebar is memoised and an inline arrow would be a new
  // function on every render — enough on its own to re-render the whole tree.
  const exitSearch = useCallback(() => setSearching(false), []);
  const openNewVault = useCallback(() => setModalOpen(true), []);

  const onCreatedVault = useCallback(
    (vault: VaultMeta) => {
      setVaults((prev) => [...prev, vault]);
      invalidateUrl(VAULTS_URL); // the cached list predates this vault
      focus(vault.id);
    },
    [focus]
  );

  const onDeletedVault = useCallback(
    (id: string) => {
      invalidateUrl(VAULTS_URL); // the cached list still has this vault
      const next = vaults.filter((v) => v.id !== id);
      setVaults(next);
      // If the focused vault went away, move to the first remaining one (or the
      // empty state when none are left). Outside the setVaults updater: a
      // a push() React runs mid-render is the "Cannot update `Router`" error.
      if (id === focusedVaultId) {
        push(docUrl(null, next[0]?.id ?? null));
      }
    },
    [docUrl, focusedVaultId, push, vaults]
  );

  /**
   * A vault was deliberately unmounted here, so it leaves the app now.
   *
   * Deliberately NOT onDeletedVault: that invalidates the cached vault list,
   * which is right when a vault is gone from the cloud and exactly wrong here —
   * the refetch would return the vault we just hid. Nothing changed server-side.
   * The registry's tombstone is what keeps it hidden on the next load; this only
   * makes it go immediately, rather than at the next reload.
   */
  const onUnmountedVault = useCallback(
    (id: string) => {
      const next = vaults.filter((v) => v.id !== id);
      setVaults(next);
      // Same reason as the delete path: if the vault you were looking at is the
      // one that went, move somewhere that still exists — and do it outside the
      // updater, since a push() during render is the "Cannot update
      // `Router`" error.
      if (id === focusedVaultId) {
        push(docUrl(null, next[0]?.id ?? null));
      }
    },
    [docUrl, focusedVaultId, push, vaults]
  );

  const onRenamedVault = useCallback((vault: VaultMeta) => {
    setVaults((prev) => prev.map((v) => (v.id === vault.id ? vault : v)));
    invalidateUrl(VAULTS_URL); // the cached list still has the old name
  }, []);

  // The list failed and nothing is mounted here: an outage, not an empty account.
  if (!loadingVaults && vaults.length === 0 && !sharedExists && vaultsError) {
    return (
      <div className="flex h-svh w-full flex-col">
        <DocsHeader
          isDesktop={isDesktop}
          canCreate={false}
          bare
          onNewFolder={() => {}}
          onNewDoc={() => {}}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <VaultLoadError onRetry={retryVaults} />
        </div>
      </div>
    );
  }

  // Only a CONFIRMED-empty account (loaded, no vaults, nothing shared) gets the
  // onboarding screen. While vaults are still loading we render the full shell
  // below with its pieces in their own loading states — so the structure (header,
  // sidebar, tabs) is there from the first paint, not a placeholder that swaps in.
  // Inside the ports provider, like the full shell below. The New Vault modal
  // reads the vaults port to know whether it can offer a folder; rendered
  // outside the provider it saw none, decided it was in a browser, and told a
  // brand-new account IN THE DESKTOP APP to download the desktop app.
  if (!loadingVaults && vaults.length === 0 && !sharedExists) {
    return (
      <DocsPortsProvider value={ports}>
        <div className="flex h-svh w-full flex-col">
          <DocsHeader
            isDesktop={isDesktop}
            canCreate={false}
            bare
            onNewFolder={() => {}}
            onNewDoc={() => {}}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <VaultEmptyState onNewVault={() => setModalOpen(true)} />
          </div>
          <NewVaultModal
            open={modalOpen}
            onOpenChange={setModalOpen}
            onCreated={onCreatedVault}
            isFirstVault
          />
        </div>
      </DocsPortsProvider>
    );
  }

  return (
    <DocsPortsProvider value={ports}>
    <DocsRoutingProvider value={routing}>
    <AgentLauncherProvider>
    <DocsStoreProvider>
      <div className="flex h-svh w-full min-w-0">
        {/* The sidebar column: its header and its tree in ONE container, so
            the header is exactly the column's width wherever this surface is
            mounted — with the web shell's icon rail beside it, or (desktop app)
            with nothing to its left. The top row is this header next to the
            workspace's tab strip, both h-11, aligned by construction. When the
            sidebar is collapsed the whole column goes, and the tab strip hosts
            the expand affordance (and, on desktop, the traffic-light room). */}
        {sidebarOpen && (
          <div className="flex w-64 shrink-0 flex-col border-r bg-sidebar/40">
            <DocsHeader
              isDesktop={isDesktop}
              canCreate={!sharedFocused}
              creating={creating}
              searching={searching}
              onToggleSearch={() => {
                // Searching implies a sidebar to search in. Opening it as part
                // of the same click beats a button that appears to do nothing.
                setSidebar(true);
                setSearching((on) => !on);
              }}
              onNewFolder={() => void newFolder()}
              onNewDoc={newDoc}
              onCollapse={() => setSidebar(false)}
            />
            <DocsSidebar
              vaults={vaults}
              focusedVaultId={focusedVaultId}
              treeVersion={treeVersion}
              loadingVaults={loadingVaults}
              syncing={syncing}
              searching={searching}
              onExitSearch={exitSearch}
              onFocus={focus}
              onOpenDoc={openDoc}
              onNewVault={openNewVault}
              onRenamed={onRenamedVault}
              onDeleted={onDeletedVault}
              onUnmounted={onUnmountedVault}
            />
          </div>
        )}

        {/* The whole tab surface: tab strip, the active doc's actions in the same
            top row, and the active doc + its panel. Mounted ONCE (fed the active
            doc, not keyed by it), so switching tabs rebinds the same editors to
            the target doc's warm Y.Doc — no remount, no refetch. */}
        <DocsWorkspace
          vaultId={sharedFocused ? null : focusedVaultId}
          tabs={tabs.tabs}
          activeTabId={tabs.activeTabId}
          activeId={activeId}
          canBack={canGoBack(tabs)}
          canForward={canGoForward(tabs)}
          onBack={goBack}
          onForward={goForward}
          onSelectTab={selectTab}
          onCloseTab={closeTab}
          onCloseOtherTabs={closeOtherTabs}
          onCloseAllTabs={closeAllTabs}
          onPinTab={pinTab}
          onNewTab={newTab}
          onCloseActiveTab={closeActiveTab}
          pinnedActive={activeTab(tabs)?.pinned ?? false}
          sidebarCollapsed={!sidebarOpen}
          onExpandSidebar={showSidebar}
          isDesktop={isDesktop}
          userId={userId}
          userName={userName}
          onOpenWikiLink={openWikiLink}
        />

        <NewVaultModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          onCreated={onCreatedVault}
          isFirstVault={vaults.length === 0}
        />
      </div>
    </DocsStoreProvider>
    </AgentLauncherProvider>
    </DocsRoutingProvider>
    </DocsPortsProvider>
  );
}
