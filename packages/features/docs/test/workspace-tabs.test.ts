import { describe, it, expect } from "vitest";
import {
  EMPTY_TABS,
  MAX_HISTORY,
  actionForUrl,
  activeDocId,
  canGoBack,
  canGoForward,
  historyModeFor,
  initialTabs,
  intentFromClick,
  layoutTabs,
  migrateOpenTabs,
  parseTabs,
  popAction,
  reachableDocIds,
  reduceTabs,
  restoreTabs,
  serializeTabs,
  tabCapacity,
  type DocTabAction,
  type DocTabsState,
  type OpenIntent,
} from "../src/logic/workspace-tabs";

// Tabs as workspaces: a click navigates the tab you're in, and a new tab is
// something you ask for. The strip of twenty squeezed tabs came from the old
// rule — every file you looked at got a tab of its own.

let next = 0;
const tabId = (): string => `t${++next}`;
const open = (docId: string, intent: OpenIntent = "current"): DocTabAction => ({
  type: "open",
  docId,
  title: docId.toUpperCase(),
  intent,
  newTabId: tabId(),
});
const run = (s: DocTabsState, ...actions: DocTabAction[]): DocTabsState =>
  actions.reduce(reduceTabs, s);
/** The document each tab shows, in strip order. */
const shown = (s: DocTabsState): (string | null)[] =>
  s.tabs.map((t) => t.history[t.index]?.docId ?? null);

describe("opening a document", () => {
  it("opens the first one in a new tab", () => {
    const s = run(EMPTY_TABS, open("a"));
    expect(shown(s)).toEqual(["a"]);
    expect(activeDocId(s)).toBe("a");
  });

  it("navigates the tab you're in instead of adding one", () => {
    const s = run(EMPTY_TABS, open("a"), open("b"));
    expect(s.tabs).toHaveLength(1);
    expect(activeDocId(s)).toBe("b");
    expect(s.tabs[0].history.map((e) => e.docId)).toEqual(["a", "b"]);
  });

  it("opens beside the current tab when asked for a new one", () => {
    let s = run(EMPTY_TABS, open("a"), open("b", "new"));
    s = run(s, { type: "select", tabId: s.tabs[0].tabId }, open("c", "new"));
    expect(shown(s)).toEqual(["a", "c", "b"]);
    expect(activeDocId(s)).toBe("c");
  });

  it("never navigates a pinned tab away", () => {
    let s = run(EMPTY_TABS, open("a"));
    s = run(s, { type: "pin", tabId: s.tabs[0].tabId, pinned: true }, open("b"));
    expect(shown(s)).toEqual(["a", "b"]);
    expect(activeDocId(s)).toBe("b");
  });

  it("changes nothing when the document is already on screen", () => {
    const s = run(EMPTY_TABS, open("a"));
    expect(reduceTabs(s, open("a"))).toBe(s);
  });

  it("fills a blank tab rather than opening another", () => {
    const s = run(EMPTY_TABS, { type: "newTab", tabId: tabId() }, open("a"));
    expect(shown(s)).toEqual(["a"]);
  });
});

describe("each tab's history", () => {
  it("goes back and forward within the tab", () => {
    let s = run(EMPTY_TABS, open("a"), open("b"), open("c"), { type: "back" });
    expect(activeDocId(s)).toBe("b");
    s = run(s, { type: "back" });
    expect(activeDocId(s)).toBe("a");
    expect(canGoBack(s)).toBe(false);
    s = run(s, { type: "forward" });
    expect(activeDocId(s)).toBe("b");
    expect(canGoForward(s)).toBe(true);
  });

  it("drops the forward history when you open something after going back", () => {
    const s = run(EMPTY_TABS, open("a"), open("b"), open("c"), { type: "back" }, { type: "back" }, open("d"));
    expect(s.tabs[0].history.map((e) => e.docId)).toEqual(["a", "d"]);
    expect(canGoForward(s)).toBe(false);
  });

  it("is separate for every tab", () => {
    let s = run(EMPTY_TABS, open("a"), open("b"), open("c", "new"));
    expect(reduceTabs(s, { type: "back" })).toBe(s); // the new tab has nowhere to go back to
    s = run(s, { type: "select", tabId: s.tabs[0].tabId }, { type: "back" });
    expect(activeDocId(s)).toBe("a");
  });

  it(`remembers at most ${MAX_HISTORY} steps`, () => {
    let s = EMPTY_TABS;
    for (let i = 0; i < 60; i++) s = reduceTabs(s, open(`d${i}`));
    expect(s.tabs[0].history).toHaveLength(MAX_HISTORY);
    expect(activeDocId(s)).toBe("d59");
  });

  it("keeps every reachable document mountable", () => {
    const s = run(EMPTY_TABS, open("a"), open("b"), open("c", "new"));
    expect([...reachableDocIds(s.tabs)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("closing tabs", () => {
  const three = (): DocTabsState => run(EMPTY_TABS, open("a"), open("b", "new"), open("c", "new"));

  it("moves to the right-hand neighbour, then the left", () => {
    let s = three();
    s = run(s, { type: "select", tabId: s.tabs[1].tabId }, { type: "close", tabId: s.tabs[1].tabId });
    expect(activeDocId(s)).toBe("c");
    s = run(s, { type: "close", tabId: s.tabs[1].tabId });
    expect(activeDocId(s)).toBe("a");
  });

  it("brings the last closed tab back with its history", () => {
    let s = run(EMPTY_TABS, open("a"), open("b"), open("c", "new"));
    s = run(s, { type: "close", tabId: s.tabs[0].tabId }, { type: "reopenClosed" });
    expect(activeDocId(s)).toBe("b");
    expect(canGoBack(s)).toBe(true);
    expect(s.closed).toHaveLength(0);
  });

  it("keeps pinned tabs through Close others and Close all", () => {
    let s = three();
    s = run(s, { type: "pin", tabId: s.tabs[0].tabId, pinned: true });
    s = run(s, { type: "closeOthers", tabId: s.tabs[2].tabId });
    expect(shown(s)).toEqual(["a", "c"]);
    s = run(s, { type: "closeAll" });
    expect(shown(s)).toEqual(["a"]);
    expect(activeDocId(s)).toBe("a");
  });

  it("selects by position, the last one past the end", () => {
    const s = three();
    expect(activeDocId(run(s, { type: "selectIndex", index: 0 }))).toBe("a");
    expect(activeDocId(run(s, { type: "selectIndex", index: 99 }))).toBe("c");
    expect(activeDocId(run(s, { type: "selectRelative", delta: 1 }))).toBe("a"); // wraps
  });
});

describe("titles", () => {
  it("follows a rename in every tab's history", () => {
    const s = run(EMPTY_TABS, open("a"), open("b"), {
      type: "retitle",
      titles: new Map([["a", "Renamed"]]),
    });
    expect(s.tabs[0].history[0].title).toBe("Renamed");
  });
});

describe("storage", () => {
  it("round-trips", () => {
    let s = run(EMPTY_TABS, open("a"), open("b"), open("c", "new"));
    s = run(s, { type: "pin", tabId: s.tabs[1].tabId, pinned: true }, { type: "back" });
    expect(parseTabs(serializeTabs(s))).toEqual(s);
  });

  it("rejects nothing-usable instead of misreading it", () => {
    expect(parseTabs(null)).toBeNull();
    expect(parseTabs([])).toBeNull();
    expect(parseTabs("tabs")).toBeNull();
    expect(parseTabs({ v: 1, tabs: [] })).toBeNull();
  });

  it("repairs what it can: a bad index, duplicate ids, a missing active tab", () => {
    const s = parseTabs({
      v: 2,
      tabs: [
        { tabId: "x", history: [{ docId: "a", title: "A" }, { docId: "" }], index: 7, pinned: false },
        { tabId: "x", history: [], index: -1, pinned: false },
        { tabId: "", history: [] },
      ],
      activeTabId: "gone",
      closed: "nope",
    });
    expect(s).toEqual({
      tabs: [{ tabId: "x", history: [{ docId: "a", title: "A" }], index: 0, pinned: false }],
      activeTabId: "x",
      closed: [],
    });
  });

  it("migrates the old one-tab-per-document list", () => {
    const s = migrateOpenTabs(
      [{ id: "a", title: "A" }, { id: "b" }, { id: "" }, 3, "junk"],
      tabId,
      "b"
    );
    expect(shown(s)).toEqual(["a", "b"]);
    expect(activeDocId(s)).toBe("b");
    expect(s.tabs[1].history[0].title).toBe("Untitled");
    expect(migrateOpenTabs(null, tabId, null)).toEqual(EMPTY_TABS);
  });
});

describe("intentFromClick", () => {
  it("opens in place on a plain click, and in a new tab on ⌘/Ctrl or middle click", () => {
    expect(intentFromClick({ metaKey: false, ctrlKey: false, button: 0 })).toBe("current");
    expect(intentFromClick({ metaKey: true, ctrlKey: false, button: 0 })).toBe("new");
    expect(intentFromClick({ metaKey: false, ctrlKey: true, button: 0 })).toBe("new");
    expect(intentFromClick({ metaKey: false, ctrlKey: false, button: 1 })).toBe("new");
  });
});

// The browser's history. Back/Forward walk the tab you're in, so only a step
// WITHIN a tab may add an entry — a switch or a close that did would make Back
// jump between tabs, or bring back a tab you closed.
describe("the address bar", () => {
  const step = (s: DocTabsState, a: DocTabAction, record = true) =>
    historyModeFor(s, reduceTabs(s, a), a, record);
  const oneTab = (): DocTabsState => run(EMPTY_TABS, open("a"));

  it("adds an entry when you open a document in the tab you're in", () => {
    expect(step(oneTab(), open("b"))).toBe("push");
  });

  it("rewrites the entry for everything else", () => {
    let s = run(EMPTY_TABS, open("a"), open("b"), open("c", "new"));
    expect(step(s, open("d", "new"))).toBe("replace"); // a new tab
    expect(step(s, { type: "select", tabId: s.tabs[0].tabId })).toBe("replace");
    expect(step(s, { type: "close", tabId: s.tabs[1].tabId })).toBe("replace");
    s = run(s, { type: "select", tabId: s.tabs[0].tabId });
    expect(step(s, { type: "back" })).toBe("replace");
    expect(step(s, open("b"))).toBe("replace"); // already on screen
  });

  it("opens from a pinned tab without adding an entry — it's a new tab", () => {
    let s = oneTab();
    s = run(s, { type: "pin", tabId: s.tabs[0].tabId, pinned: true });
    expect(step(s, open("b"))).toBe("replace");
  });

  it("doesn't add a second entry for a navigation that made its own", () => {
    expect(step(oneTab(), open("b"), false)).toBe("replace");
  });

  it("reads the browser's Back and Forward from the positions it moved between", () => {
    expect(popAction(5, 4)).toEqual({ type: "back" });
    expect(popAction(5, 6)).toEqual({ type: "forward" });
    expect(popAction(5, 5)).toBeNull();
  });

  it("opens a document the URL names in the tab you're in", () => {
    const s = oneTab();
    expect(actionForUrl(s, "b", "B", "t-x")).toEqual({
      type: "open",
      docId: "b",
      title: "B",
      intent: "current",
      newTabId: "t-x",
    });
    expect(actionForUrl(s, "a", "A", "t-x")).toBeNull(); // already showing it
    expect(actionForUrl(s, null, "", "t-x")).toBeNull(); // the index
  });
});

// Arriving: the first render (server and browser alike) and then the stored tabs.
describe("restoring tabs", () => {
  const titles = new Map([["b", "Bee"]]);
  const stored = (): DocTabsState => run(EMPTY_TABS, open("a"), open("b", "new"), open("c", "new"));

  it("renders the URL's document before storage can be read", () => {
    expect(activeDocId(initialTabs("x"))).toBe("x");
    expect(initialTabs(null)).toEqual(EMPTY_TABS);
    // Deterministic, so the server's render and the browser's agree.
    expect(initialTabs("x")).toEqual(initialTabs("x"));
  });

  it("prefers the stored tabs over the old format", () => {
    const s = restoreTabs({
      stored: serializeTabs(stored()),
      legacy: [{ id: "zzz", title: "Old" }],
      urlDocId: null,
      titles,
      newTabId: tabId,
    });
    expect(shown(s)).toEqual(["a", "b", "c"]);
  });

  it("migrates the old format when nothing new is stored", () => {
    const s = restoreTabs({
      stored: null,
      legacy: [{ id: "a", title: "A" }, { id: "b" }],
      urlDocId: "a",
      titles,
      newTabId: tabId,
    });
    expect(shown(s)).toEqual(["a", "b"]);
    expect(activeDocId(s)).toBe("a");
    expect(s.tabs[1].history[0].title).toBe("Bee"); // filled in from the doc list
  });

  it("shows a reloaded document in the tab that already has it", () => {
    const s = restoreTabs({
      stored: serializeTabs(stored()),
      legacy: null,
      urlDocId: "a",
      titles,
      newTabId: tabId,
    });
    expect(shown(s)).toEqual(["a", "b", "c"]);
    expect(activeDocId(s)).toBe("a");
  });

  it("opens a deep link in a new tab, leaving the others as they were", () => {
    const s = restoreTabs({
      stored: serializeTabs(stored()),
      legacy: null,
      urlDocId: "b",
      titles: new Map(),
      newTabId: tabId,
    });
    expect(activeDocId(s)).toBe("b"); // tab 2 already had it
    const deep = restoreTabs({
      stored: serializeTabs(stored()),
      legacy: null,
      urlDocId: "new-doc",
      titles: new Map(),
      newTabId: tabId,
    });
    expect(shown(deep)).toEqual(["a", "b", "c", "new-doc"]);
    expect(activeDocId(deep)).toBe("new-doc");
  });
});

// A lot of tabs. The strip doesn't scroll: tabs shrink to a readable minimum,
// and the ones that still don't fit go in a menu. The tab you're in never does.
describe("fitting the strip", () => {
  const tabs = (n: number, pinned: number[] = []) =>
    Array.from({ length: n }, (_, i) => ({ tabId: `t${i}`, pinned: pinned.includes(i) }));
  const ids = (list: { tabId: string }[]) => list.map((t) => t.tabId);

  it("counts how many tabs fit at their narrowest", () => {
    expect(tabCapacity(1000, 120, 4)).toBe(8); // 8 × 120 + 7 × 4 = 988
    expect(tabCapacity(988, 120, 4)).toBe(8);
    expect(tabCapacity(987, 120, 4)).toBe(7);
    expect(tabCapacity(50, 120, 4)).toBe(1); // never zero — the active tab shows
  });

  it("shows every tab when they fit", () => {
    const { visible, overflow } = layoutTabs(tabs(5), "t4", 5);
    expect(ids(visible)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(overflow).toEqual([]);
  });

  it("moves the ones that don't fit into the menu, in strip order", () => {
    const { visible, overflow } = layoutTabs(tabs(10), "t0", 4);
    expect(ids(visible)).toEqual(["t0", "t1", "t2", "t3"]);
    expect(ids(overflow)).toEqual(["t4", "t5", "t6", "t7", "t8", "t9"]);
  });

  it("always keeps the tab you're in on the strip", () => {
    const { visible, overflow } = layoutTabs(tabs(10), "t9", 4);
    expect(ids(visible)).toEqual(["t0", "t1", "t2", "t9"]);
    expect(ids(overflow)).not.toContain("t9");
  });

  it("keeps pinned tabs on the strip ahead of the others", () => {
    const { visible } = layoutTabs(tabs(10, [7]), "t9", 3);
    expect(ids(visible)).toEqual(["t0", "t7", "t9"]);
  });

  it("shows just the active tab when only one fits", () => {
    expect(ids(layoutTabs(tabs(3), "t2", 1).visible)).toEqual(["t2"]);
  });
});
