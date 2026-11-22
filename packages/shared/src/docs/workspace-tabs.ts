// Tabs as workspaces — Obsidian's model.
//
// A tab is a place you work, not a document you have open. It shows one document
// at a time and keeps its own back/forward history, so clicking a file in the
// tree or following a link navigates THIS tab instead of adding another. A new
// tab is something you ask for (⌘/Ctrl-click, middle-click, ⌘T); a pinned tab is
// never navigated away from — whatever you open from it lands in a new tab.
//
// The one-tab-per-document model this replaces added a tab for every file you
// looked at, so browsing a folder left a strip of twenty tabs squeezed to a few
// letters each.
//
// Pure: the reducer takes a state and an action and returns the next state — no
// storage, URL or React. The documents surface does those. That keeps the rules
// testable, and it is why a new tab's id arrives in the action rather than being
// made here.

/** Where a document opens: in the tab you're in, or a new one beside it. */
export type OpenIntent = "current" | "new";

export interface HistEntry {
  docId: string;
  title: string;
}

/** A tab in the document workspace. (Not a subtab — those are WorkspaceTab.) */
export interface DocTab {
  tabId: string;
  /** Documents visited in this tab, oldest first. Empty for a new, blank tab. */
  history: HistEntry[];
  /** Position in `history` of the document on screen; -1 for a blank tab. */
  index: number;
  /** Never navigated away from: opening a document from it opens a new tab. */
  pinned: boolean;
}

export interface DocTabsState {
  tabs: DocTab[];
  activeTabId: string | null;
  /** Recently closed tabs, most recent first — what ⌘⇧T brings back. */
  closed: DocTab[];
}

export type DocTabAction =
  | { type: "open"; docId: string; title: string; intent: OpenIntent; newTabId: string }
  | { type: "newTab"; tabId: string }
  | { type: "select"; tabId: string }
  | { type: "selectRelative"; delta: number }
  | { type: "selectIndex"; index: number }
  | { type: "close"; tabId: string }
  | { type: "closeOthers"; tabId: string }
  | { type: "closeAll" }
  | { type: "reopenClosed" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "pin"; tabId: string; pinned: boolean }
  | { type: "retitle"; titles: ReadonlyMap<string, string> };

/** How far back a tab remembers. Older entries fall off the front. */
export const MAX_HISTORY = 50;
/** How many closed tabs ⌘⇧T can bring back. */
export const MAX_CLOSED = 20;

export const EMPTY_TABS: DocTabsState = { tabs: [], activeTabId: null, closed: [] };

export function activeTab(s: DocTabsState): DocTab | null {
  return s.tabs.find((t) => t.tabId === s.activeTabId) ?? null;
}

/** The document a tab is showing, or null for a blank tab. */
export function currentEntry(t: DocTab | null): HistEntry | null {
  return t && t.index >= 0 ? (t.history[t.index] ?? null) : null;
}

export function activeDocId(s: DocTabsState): string | null {
  return currentEntry(activeTab(s))?.docId ?? null;
}

export function canGoBack(s: DocTabsState): boolean {
  const t = activeTab(s);
  return t !== null && t.index > 0;
}

export function canGoForward(s: DocTabsState): boolean {
  const t = activeTab(s);
  return t !== null && t.index < t.history.length - 1;
}

/** Every document a tab can reach — on screen, or a Back/Forward away. */
export function reachableDocIds(tabs: readonly DocTab[]): Set<string> {
  const ids = new Set<string>();
  for (const t of tabs) for (const e of t.history) ids.add(e.docId);
  return ids;
}

/**
 * What a click asks for. ⌘/Ctrl-click and middle-click open a new tab — the
 * browser's gestures, and Obsidian's. Everything else opens in place.
 */
export function intentFromClick(e: { metaKey: boolean; ctrlKey: boolean; button: number }): OpenIntent {
  return e.metaKey || e.ctrlKey || e.button === 1 ? "new" : "current";
}

function blankTab(tabId: string): DocTab {
  return { tabId, history: [], index: -1, pinned: false };
}

/** Put `tab` right after the active tab (or at the end), and make it active. */
function insertActive(s: DocTabsState, tab: DocTab): DocTabsState {
  const at = s.tabs.findIndex((t) => t.tabId === s.activeTabId);
  const tabs =
    at < 0 ? [...s.tabs, tab] : [...s.tabs.slice(0, at + 1), tab, ...s.tabs.slice(at + 1)];
  return { ...s, tabs, activeTabId: tab.tabId };
}

function replaceTab(s: DocTabsState, tab: DocTab): DocTabsState {
  return { ...s, tabs: s.tabs.map((t) => (t.tabId === tab.tabId ? tab : t)) };
}

/** Visit `entry` in a tab: anything forward of where it was is dropped, like a browser. */
function visit(tab: DocTab, entry: HistEntry): DocTab {
  const history = [...tab.history.slice(0, tab.index + 1), entry].slice(-MAX_HISTORY);
  return { ...tab, history, index: history.length - 1 };
}

function retitleTab(t: DocTab, titles: ReadonlyMap<string, string>): DocTab {
  let changed = false;
  const history = t.history.map((e) => {
    const title = titles.get(e.docId);
    if (!title || title === e.title) return e;
    changed = true;
    return { ...e, title };
  });
  return changed ? { ...t, history } : t;
}

/** Add closed tabs to the reopen list. A blank tab has nothing to come back to. */
function remember(closed: DocTab[], gone: DocTab[]): DocTab[] {
  const worth = gone.filter((t) => t.history.length > 0).reverse();
  return [...worth, ...closed].slice(0, MAX_CLOSED);
}

export function reduceTabs(s: DocTabsState, a: DocTabAction): DocTabsState {
  switch (a.type) {
    case "open": {
      const entry = { docId: a.docId, title: a.title || "Untitled" };
      const tab = activeTab(s);
      if (a.intent === "current" && tab && !tab.pinned) {
        const here = currentEntry(tab);
        if (here?.docId === a.docId) {
          // Already showing it: nothing to navigate, but a fresher title is news.
          return a.title && a.title !== here.title
            ? replaceTab(s, retitleTab(tab, new Map([[a.docId, a.title]])))
            : s;
        }
        return replaceTab(s, visit(tab, entry));
      }
      return insertActive(s, visit(blankTab(a.newTabId), entry));
    }
    case "newTab":
      return insertActive(s, blankTab(a.tabId));
    case "select":
      return s.activeTabId !== a.tabId && s.tabs.some((t) => t.tabId === a.tabId)
        ? { ...s, activeTabId: a.tabId }
        : s;
    case "selectRelative": {
      const n = s.tabs.length;
      if (n === 0) return s;
      const at = Math.max(0, s.tabs.findIndex((t) => t.tabId === s.activeTabId));
      const next = s.tabs[(((at + a.delta) % n) + n) % n];
      return next.tabId === s.activeTabId ? s : { ...s, activeTabId: next.tabId };
    }
    case "selectIndex": {
      if (s.tabs.length === 0) return s;
      // Past the end means the last tab — ⌘9, everywhere.
      const t = s.tabs[Math.min(Math.max(a.index, 0), s.tabs.length - 1)];
      return t.tabId === s.activeTabId ? s : { ...s, activeTabId: t.tabId };
    }
    case "close": {
      const at = s.tabs.findIndex((t) => t.tabId === a.tabId);
      if (at < 0) return s;
      const tabs = s.tabs.filter((t) => t.tabId !== a.tabId);
      // Closing the tab you're in moves to its right-hand neighbour, else the left.
      const activeTabId =
        s.activeTabId !== a.tabId ? s.activeTabId : ((tabs[at] ?? tabs[at - 1])?.tabId ?? null);
      return { tabs, activeTabId, closed: remember(s.closed, [s.tabs[at]]) };
    }
    case "closeOthers": {
      if (!s.tabs.some((t) => t.tabId === a.tabId)) return s;
      // Pinned tabs are the ones you said to keep.
      const keep = (t: DocTab) => t.tabId === a.tabId || t.pinned;
      const gone = s.tabs.filter((t) => !keep(t));
      if (gone.length === 0) return s.activeTabId === a.tabId ? s : { ...s, activeTabId: a.tabId };
      return { tabs: s.tabs.filter(keep), activeTabId: a.tabId, closed: remember(s.closed, gone) };
    }
    case "closeAll": {
      const tabs = s.tabs.filter((t) => t.pinned);
      const gone = s.tabs.filter((t) => !t.pinned);
      if (gone.length === 0) return s;
      const activeTabId = tabs.some((t) => t.tabId === s.activeTabId)
        ? s.activeTabId
        : (tabs[0]?.tabId ?? null);
      return { tabs, activeTabId, closed: remember(s.closed, gone) };
    }
    case "reopenClosed": {
      const [back, ...rest] = s.closed;
      if (!back) return s;
      if (s.tabs.some((t) => t.tabId === back.tabId)) return { ...s, closed: rest };
      return { ...insertActive(s, back), closed: rest };
    }
    case "back":
    case "forward": {
      const tab = activeTab(s);
      if (!tab) return s;
      const index = tab.index + (a.type === "back" ? -1 : 1);
      if (index < 0 || index >= tab.history.length) return s;
      return replaceTab(s, { ...tab, index });
    }
    case "pin": {
      const tab = s.tabs.find((t) => t.tabId === a.tabId);
      return !tab || tab.pinned === a.pinned ? s : replaceTab(s, { ...tab, pinned: a.pinned });
    }
    case "retitle": {
      let changed = false;
      const tabs = s.tabs.map((t) => {
        const next = retitleTab(t, a.titles);
        if (next !== t) changed = true;
        return next;
      });
      return changed ? { ...s, tabs } : s;
    }
  }
}

// --- storage --------------------------------------------------------------

/** A JSON value — what storage holds. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Bumped when the stored shape changes; anything else is ignored, not misread. */
const STORE_VERSION = 2;

function tabToJson(t: DocTab): JsonValue {
  return {
    tabId: t.tabId,
    history: t.history.map((e) => ({ docId: e.docId, title: e.title })),
    index: t.index,
    pinned: t.pinned,
  };
}

export function serializeTabs(s: DocTabsState): JsonValue {
  return {
    v: STORE_VERSION,
    tabs: s.tabs.map(tabToJson),
    activeTabId: s.activeTabId,
    closed: s.closed.map(tabToJson),
  };
}

function parseTab(v: JsonValue): DocTab | null {
  if (!isObject(v) || typeof v.tabId !== "string" || v.tabId === "") return null;
  if (!Array.isArray(v.history)) return null;
  const history: HistEntry[] = [];
  for (const e of v.history) {
    if (isObject(e) && typeof e.docId === "string" && e.docId !== "") {
      history.push({ docId: e.docId, title: typeof e.title === "string" ? e.title : "Untitled" });
    }
  }
  const raw = typeof v.index === "number" && Number.isInteger(v.index) ? v.index : history.length - 1;
  const index = history.length === 0 ? -1 : Math.min(Math.max(raw, 0), history.length - 1);
  return { tabId: v.tabId, history, index, pinned: v.pinned === true };
}

/** Stored tabs, or null when there's nothing usable (absent, another version, junk). */
export function parseTabs(v: JsonValue | null): DocTabsState | null {
  if (!isObject(v) || v.v !== STORE_VERSION || !Array.isArray(v.tabs)) return null;
  const seen = new Set<string>();
  const tabs: DocTab[] = [];
  for (const raw of v.tabs) {
    const t = parseTab(raw);
    if (!t || seen.has(t.tabId)) continue;
    seen.add(t.tabId);
    tabs.push(t);
  }
  const closed: DocTab[] = [];
  if (Array.isArray(v.closed)) {
    for (const raw of v.closed) {
      const t = parseTab(raw);
      if (t && !seen.has(t.tabId) && closed.length < MAX_CLOSED) {
        seen.add(t.tabId);
        closed.push(t);
      }
    }
  }
  const wanted = typeof v.activeTabId === "string" ? v.activeTabId : null;
  const activeTabId = tabs.some((t) => t.tabId === wanted) ? wanted : (tabs[0]?.tabId ?? null);
  return { tabs, activeTabId, closed };
}

/**
 * The previous format — a flat list of open documents, one per tab — as
 * workspaces: each old tab becomes a tab whose history is that one document.
 * `activeDocId` (the URL's document, if any) picks which of them is active.
 */
export function migrateOpenTabs(
  v: JsonValue | null,
  newTabId: () => string,
  activeDocId: string | null
): DocTabsState {
  if (!Array.isArray(v)) return EMPTY_TABS;
  const tabs: DocTab[] = [];
  for (const o of v) {
    if (!isObject(o) || typeof o.id !== "string" || o.id === "") continue;
    const title = typeof o.title === "string" && o.title !== "" ? o.title : "Untitled";
    tabs.push(visit(blankTab(newTabId()), { docId: o.id, title }));
  }
  const active = tabs.find((t) => currentEntry(t)?.docId === activeDocId) ?? tabs[0] ?? null;
  return { tabs, activeTabId: active?.tabId ?? null, closed: [] };
}

// --- the first render, and restoring -----------------------------------------

/**
 * What the first render shows, before the stored tabs can be read: the URL's
 * document, in a tab of its own. Deterministic, because the server renders it
 * too — storage is only readable once mounted.
 */
export function initialTabs(urlDocId: string | null): DocTabsState {
  return urlDocId
    ? reduceTabs(EMPTY_TABS, { type: "open", docId: urlDocId, title: "", intent: "new", newTabId: "url" })
    : EMPTY_TABS;
}

/**
 * The tabs to show when a vault opens: the stored set (or the old format,
 * migrated), with the URL's document on screen — in the tab that already has
 * it, or a new one, never over what another tab was showing — and the titles
 * the doc list already knows filled in (a deep-linked document arrives untitled).
 */
export function restoreTabs(opts: {
  stored: JsonValue | null;
  legacy: JsonValue | null;
  urlDocId: string | null;
  titles: ReadonlyMap<string, string>;
  newTabId: () => string;
}): DocTabsState {
  const { urlDocId, titles, newTabId } = opts;
  let s = parseTabs(opts.stored) ?? migrateOpenTabs(opts.legacy, newTabId, urlDocId);
  if (urlDocId && activeDocId(s) !== urlDocId) {
    const holder = s.tabs.find((t) => currentEntry(t)?.docId === urlDocId);
    s = holder
      ? reduceTabs(s, { type: "select", tabId: holder.tabId })
      : reduceTabs(s, {
          type: "open",
          docId: urlDocId,
          title: titles.get(urlDocId) ?? "",
          intent: "new",
          newTabId: newTabId(),
        });
  }
  return reduceTabs(s, { type: "retitle", titles });
}

// --- the address bar -----------------------------------------------------------

/**
 * Whether an action adds a browser-history entry. Only a step within the tab
 * you're in does — opening a document there — so Back and Forward move through
 * that tab's history, and never reopen a tab you closed or jump between tabs.
 * `record` is false for a navigation that already made its own entry (a
 * router.push elsewhere on the page).
 */
export function historyModeFor(
  prev: DocTabsState,
  next: DocTabsState,
  action: DocTabAction,
  record = true
): "push" | "replace" {
  const stepped =
    record &&
    action.type === "open" &&
    next.activeTabId === prev.activeTabId &&
    activeDocId(next) !== activeDocId(prev);
  return stepped ? "push" : "replace";
}

/** What the browser's Back/Forward means, from the history positions it moved between. */
export function popAction(fromSeq: number, toSeq: number): DocTabAction | null {
  if (toSeq < fromSeq) return { type: "back" };
  if (toSeq > fromSeq) return { type: "forward" };
  return null;
}

/**
 * An address-bar change that didn't come through the tabs (a router.push
 * elsewhere, a link into the surface): its document opens in the tab you're
 * in. Null when there's nothing to open — the URL already shows the active
 * document, or it's the index.
 */
export function actionForUrl(
  s: DocTabsState,
  urlDocId: string | null,
  title: string,
  newTabId: string
): DocTabAction | null {
  if (!urlDocId || urlDocId === activeDocId(s)) return null;
  return { type: "open", docId: urlDocId, title, intent: "current", newTabId };
}

// --- fitting the strip -----------------------------------------------------------

/**
 * How many tabs fit in `widthPx` at their narrowest. Never less than one: the
 * active tab always shows.
 */
export function tabCapacity(widthPx: number, minTabPx: number, gapPx: number): number {
  return Math.max(1, Math.floor((widthPx + gapPx) / (minTabPx + gapPx)));
}

/**
 * Which tabs the strip shows when they don't all fit, and which go in the
 * overflow menu — the strip doesn't scroll. The active tab always shows, then
 * pinned ones, then the rest in strip order until `capacity` is used up. Both
 * lists keep strip order.
 */
export function layoutTabs<T extends { tabId: string; pinned: boolean }>(
  tabs: readonly T[],
  activeTabId: string | null,
  capacity: number
): { visible: T[]; overflow: T[] } {
  if (tabs.length <= capacity) return { visible: [...tabs], overflow: [] };
  const keep = new Set<string>();
  const add = (t: T) => {
    if (keep.size < capacity) keep.add(t.tabId);
  };
  const active = tabs.find((t) => t.tabId === activeTabId);
  if (active) add(active);
  for (const t of tabs) if (t.pinned) add(t);
  for (const t of tabs) add(t);
  return {
    visible: tabs.filter((t) => keep.has(t.tabId)),
    overflow: tabs.filter((t) => !keep.has(t.tabId)),
  };
}
