# Phase 1 · Workspace layout: everything is a panel, and panels move

Status: draft · 2026-09-17 · not started · **sequencing superseded** by
[`core-plugins-and-content.md`](./core-plugins-and-content.md): the panel model
holds, but it lands after records, commands and workflows, not before.
How panels are driven — by a person and by the agent, through one command
vocabulary — is [`model-view-command.md`](./model-view-command.md).
Companion to [`plugin-system-plan.md`](./plugin-system-plan.md),
[`surface-contract.md`](./surface-contract.md) and
[`reader-plugin-refactor-and-mobile.md`](./reader-plugin-refactor-and-mobile.md).

A PDF reader, a browser, a calendar, a stock ticker, a markdown preview, the
agent. Six things that want to be on screen, in positions the user picks. The
workspace today can hold exactly three of them in exactly three places, and
the seams that say so are already visible in the code.

This doc replaces the fixed zones with a **layout tree of panels**, and says
what that costs.

The point isn't rearranging windows. It's that **building a daily routine or a
task-specific agent workflow should be composing panels you already have,
rather than writing UI.** A morning routine is a calendar, today's list and
the agent, on a trigger. Reading a paper is a PDF, the agent and a notes pane.
If a layout is data, a workflow can ship one, and the workflow author writes a
brief instead of a screen. That is the goal; the tree is what makes it
possible. See [Why: workflows compose panels](#why-workflows-compose-panels).

---

## What's fixed today

```
docs-shell                        h-svh flex
├── DocsSidebar                   left, boolean open/closed
└── DocsWorkspace
    ├── tabStrip                  one strip, documents only
    └── flex row
        ├── keep-alive stack      flex-1 — DocViewSlot per recently-viewed doc
        │   └── DocView
        │       └── aside         panel tabs: tabs | comments | history | claude
        └── agentColumn           the claude tab, hoisted up one level
```

Seven things are baked in, and each one blocks something on the list:

1. **Three zones, fixed.** Left sidebar, center, right panel. There is no
   fourth, no bottom, no two-centers.
2. **One panel width for the whole app.** `panel-width.ts` keys a single
   number, and one CSS variable `--doc-panel-w` feeds every column that reads
   it. Two panels of different widths are unrepresentable.
3. **Panel contents are a closed union** — `PanelTab = "tabs" | "comments" |
   "history" | "claude"` — written out three times, in `doc-view.tsx`,
   `docs-workspace.tsx` and `guest-doc.tsx`.
4. **The agent is special-cased out of that union at runtime.** `agentHosted`
   and `showAside` exist so the workspace can draw the `claude` panel one
   level up from its siblings while the document draws the rest. That boolean
   is the structure failing to express "this panel belongs to the workspace,
   that one belongs to the document" — the clearest evidence that the zones
   are too rigid, and it's already load-bearing.
5. **Only documents go in the center.** `HistEntry` is `{ docId, title }`, the
   keep-alive stack is a document store, and `DocViewSlot` takes a document
   entry.
6. **The tab strip belongs to the center.** Two panels can't be tabbed
   together anywhere else.
7. **The sidebar is a boolean, not a container.** One component, open or shut.

## The model

### A layout tree whose leaves are panels

```ts
type LayoutNode =
  | { kind: "split"; dir: "row" | "col"; children: LayoutNode[]; sizes: number[] }
  | { kind: "tabs";  id: string; children: Leaf[]; active: number }
  | Leaf;

interface Leaf {
  kind: "leaf";
  id: string;            // stable for the life of the panel instance
  panel: PanelRef;
}

interface PanelRef {
  type: string;          // "reader.pdf", "calendar.month", "stocks.ticker", "agent.claude"
  state: JsonValue;      // { assetPath } · { month } · { symbols } — small and serializable
}

interface WorkspaceLayout {
  root: LayoutNode;
  focusedLeafId: string | null;
}
```

Splits nest, tabs hold leaves, leaves hold one panel instance each. The
sidebar is a split child. The agent is a leaf. A markdown preview beside its
editor is a `row` split of two leaves. The Duo is a `row` split of two.

### Everything is a panel

There is no "content view" tier and "widget" tier. That distinction is exactly
what freezes positions: the moment a calendar is a *widget*, it lives in the
widget rail forever. One kind of thing, registered once, placeable anywhere.

What differs between panels isn't their class, it's what they **declare**:

```ts
interface PanelType {
  id: string;
  title: string;
  icon: string;
  component: string;
  /** Below this it should not be asked to render. */
  minSize: { w: number; h: number };
  /** Where a fresh instance lands when nothing says otherwise. A HINT. */
  preferred?: { zone: "center" | "side" | "rail" | "bottom"; w?: number; h?: number };
  /** Files this panel can open, if any. A PDF reader has one; a ticker doesn't. */
  contentKinds?: string[];
  /** Must not unmount when hidden. */
  keepAlive?: boolean;
  /** Rendered outside the DOM, positioned by rect (a native browser view). */
  native?: boolean;
  /** Runs in an iframe with no network and no credentials; data arrives over a
   *  message bridge. Implies keepAlive — reparenting an iframe reloads it. */
  sandboxed?: boolean;
  /** Its half of the surface contract. */
  surface?: { provides: string[]; accepts: string[] };
}
```

`preferred` is the piece that makes this feel designed rather than arbitrary.
A calendar opened from the command palette lands center; a ticker lands in a
rail. Both can then be dragged anywhere. A hint decides the first placement; it
never constrains the final one.

`contentKinds` is how "open this file" resolves to a panel, and it replaces
the separate `contributes.views` idea in the reader doc: **a content view is
just a panel that declares which files it can open.** One contribution point,
not two.

### Geometry and lifetime are separate

This is the load-bearing decision, and the codebase already half-implements it.

The agent panel's entire design is that it never remounts, because remounting
kills the Claude process mid-task — which is why it's hoisted out of `DocView`
today. In a tree the user can rearrange, *every move is a re-parent*, and a
re-parent in React unmounts and remounts. Naively, dragging the agent panel
one pane over would kill the conversation.

So the tree decides **where a panel is**, and a flat registry decides
**whether it's alive**:

- Keep-alive panels mount once into a stable, flat host and are positioned
  into their leaf's rectangle. Moving a leaf changes a rect, not a parent.
- This is precisely the trick already used for documents — "one mounted slot
  per recently-viewed doc, the active one shown, the rest `display:none`" —
  generalized from documents to panels.

The same separation is what lets a **native panel** work at all. A browser
panel on the desktop host is a `WebContentsView`, which the OS positions over
the window; it cannot be a child of a `<div>`. It subscribes to its leaf's
rect and draws itself there. A design where the tree owned mounting could
never host one; this one hosts it with no special case beyond `native: true`.

The same applies, and is **mandatory rather than an optimisation**, for a
**sandboxed panel** — a custom or agent-generated view in an iframe (see
[`core-plugins-and-content.md`](./core-plugins-and-content.md)). Reparenting an
iframe in the DOM *reloads it*: the page restarts, its state is gone. So a
`sandboxed: true` panel cannot be moved by re-parenting under any
circumstances, and has to be mounted flat and positioned by rect like every
other keep-alive panel. A design where the tree owned mounting could host
neither a browser view nor a generated one.

### Sizes live on nodes

`--doc-panel-w` becomes a size per split child. Keep the drag trick in
`panel-width.ts` exactly as it is — write to a CSS variable during the drag and
tell React once on pointer-up — because the reason it exists (a drag was
re-rendering every mounted document sixty times a second) gets worse with more
panels, not better. It generalizes: one variable per split handle instead of
one for the app.

### Tabs are a node, not a strip

`workspace-tabs.ts` is pure, has 38 tests, and already implements history,
pin, close, reopen and overflow. It becomes the reducer for **a** tabs node
rather than **the** strip, with `HistEntry` widening from `{ docId, title }`
to a `PanelRef`. Everything it does is agnostic to what a tab holds, so this
is reuse, not a rewrite — and it means you can tab a calendar next to a PDF,
with back/forward, because that logic was never about documents.

---

## Why: workflows compose panels

The plugin plan already says a workflow style is a plugin and a specific
workflow is content — a document with frontmatter and a checklist of durable
steps. The missing half is that a workflow has nowhere to *live*. It produces
a document and a run view, and everything else it might want on screen has to
be opened by hand.

A layout is serializable data, so a workflow can carry one:

```yaml
---
trigger: cron 0 8 * * 1-5
layout:
  - calendar.day
  - today.list
  - agent.claude
tools: [calendar, docs]
---
Summarize today's meetings into the daily note, and flag anything
that collides with a deadline.
```

There is a working sketch of this in
[`examples/workflow-contract.html`](./examples/workflow-contract.html) — one
document rendered live by a checklist, a canvas, a run view and a workspace
preview, with agent edits applying the same patches a user edit does. It is a
single file with no build step; open it in a browser.

Four things follow, and together they're what "easy" means here:

- **A workflow arranges its own workspace.** Running it — from the trigger,
  or by opening it — puts those panels up. A daily routine stops being "a doc
  plus three things you open by habit" and becomes one thing you start.
- **Panels are addressable, so steps can target them.** A step says put the
  digest in `today.list`, show the paper in `reader.pdf`. Those are the
  surface contract's commands with a destination — `open`, `reveal`,
  `insert` against a named leaf. No new mechanism, and no bespoke integration
  per workflow.
- **The agent already sees what's around it.** The surface contract gives it
  the focused panel's content and selection. So "summarize what's on my
  calendar into today's note" is composition of panels that already exist,
  not a calendar integration written for this workflow.
- **Presentation stays out of the semantics.** `steps` is what the workflow
  means; where a canvas draws them is `views.canvas`, a namespace that UI
  owns. A canvas defined later gets its own namespace the same way, with no
  migration and nothing for the checklist to learn.
- **A view renders what it understands and ignores the rest.** One added
  field — "ask before this step" — is a pill in the checklist, a marker on a
  node, and a pause in the run. A view that had never heard of it draws
  nothing. That rule is what lets a new UI ship against an old document.
- **The run view is a panel.** It sits beside the panels it's driving instead
  of replacing them, which is the difference between watching a run and using
  the thing the run is working on.

The test for whether this worked: **a user builds a useful daily workflow
without writing a component.** They pick panels, write a brief, set a trigger.
If that requires a plugin, the layout work didn't pay for itself.

This also sets the boundary for `PanelRef.state`. A workflow has to be able to
write a panel's opening state — the month, the document, the symbols — as
plain data in frontmatter. Anything a panel needs that can't be written down
that way is something a workflow can't drive.

## What this costs

- **Panels must be container-responsive, not viewport-responsive.** A panel's
  width becomes user-controlled and arbitrary: a calendar at 280px, a PDF at
  1400px, a ticker at 200px. Media queries are the wrong tool; container
  queries and `minSize` are the contract. This is a real constraint on every
  panel author, third parties included, and it's the most likely thing to be
  got wrong.
- **Drag-and-drop rearranging is a substantial UI.** Drop zones, split
  previews, tab-vs-split targets, keyboard equivalents. `@dnd-kit` is already
  a dependency and is already used by the kanban and attention views, so the
  primitive is in hand; the interaction design isn't.
- **Persistence and migration.** Three keys today (`mb:docsSidebarOpen`,
  `docPanelWidth`, the serialized tabs) become one layout tree, and existing
  users' state has to map onto it. `workspace-tabs.ts` already has a migration
  from the old per-document list, so there's a pattern to copy.
- **The focused-leaf concept is new and the surface contract depends on it.**
  See below.
- **A tree with no constraints produces bad layouts.** `minSize`, a maximum
  split depth, and a "reset layout" command are not polish; they're what keeps
  it usable.

## What it changes elsewhere

**The surface contract.** Its rule "one active surface — the workspace has one
content slot, so the agent sees the active tab" was written for the fixed
layout. With a tree there is no content slot, so it becomes: *the agent sees
the **focused leaf**.* That needs `focusedLeafId` in the layout state, which
is why it's in `WorkspaceLayout` above. It also raises a question the fixed
layout couldn't: with two agent panels open, does each follow focus, or can
one be pinned to a specific leaf? Pinning is clearly useful — an agent working
on a PDF while you edit notes beside it — and it should be panel state, not a
global mode.

**The reader doc.** `contributes.views` with a content kind becomes
`contributes.panels` with `contentKinds`. R2 in that doc ("a tab can hold
something that isn't a document") is the same change as widening `HistEntry`
here, so the two should land together.

**Mobile and the Duo.** A phone doesn't have room for a tree, but it doesn't
need a different layout — it needs a **projection** of the same one. A `split`
renders as a tab switcher or a sheet when there isn't room for its children's
`minSize`. On a dual-screen device, a top-level `row` split with two children
maps onto the two segments, hinge on the divider. One layout, three renderings,
rather than a desktop layout and a mobile layout that drift apart.

---

---

## Phasing

Each step leaves the app working, and the first two are invisible to users.

| # | Step | Why here |
|---|---|---|
| L1 | Name the types (`LayoutNode`, `Leaf`, `PanelRef`, `PanelType`) and a pure reducer beside `workspace-tabs.ts`, with tests. No UI. | The reducer is where the bugs are; pure and tested first is how the tab work already went |
| L2 | Render today's exact layout *from* a hardcoded tree. Sidebar, center, agent column — same pixels, new mechanism. | Proves the renderer without changing anything a user sees |
| L3 | Flat mount registry + rect positioning for `keepAlive` panels; delete `agentHosted`/`showAside` | Removes the hack, and is the prerequisite for any movement |
| L4 | Sizes per split node; `panel-width.ts`'s drag generalizes to any handle | One width for the app stops being true |
| L5 | Panel registry; `comments`, `history`, `claude`, the sidebar and the doc editor re-register as panel types | First-party through the same door, as the plugin plan requires |
| L6 | `tabs` nodes anywhere; `HistEntry` widens to `PanelRef` | Tab a calendar next to a PDF |
| L7 | Drag to move, split and tab panels; layout persistence; reset | The visible feature |
| L8 | `contributes.panels` as a plugin contribution point, with `native` | Third-party panels; the browser panel becomes possible |
| L9 | Projection for narrow and dual-screen | Phone and Duo |
| L10 | `layout` in workflow frontmatter; steps target panels by leaf id; the run view as a panel | The goal — a workflow composes panels instead of shipping UI |

L1 through L3 are worth doing regardless of whether panels ever move, because
L3 deletes a hack that is already costing something.

## Open questions

1. **Can a panel type be instantiated more than once?** Two PDFs side by side
   is obviously yes. Two agents is probably yes but has consequences (two
   Claude processes, two sessions). Two sidebars is probably no. Is that a
   `singleton` flag, or does it fall out of `preferred.zone`?
2. **Does a leaf's panel state persist across a reload, or only its ref?** A
   PDF's scroll position and a calendar's month are cheap and obviously worth
   keeping. An agent's conversation already persists server-side. A browser
   panel's history is neither.
3. **Named layouts.** Obsidian has workspace presets ("reading", "writing").
   The tree makes them nearly free, and they're the natural place to put "the
   Duo layout" as a saved thing rather than a responsive rule.
4. **Where does the command palette put a panel with no `preferred`?** Focused
   leaf's tab group, a new split, or ask. Getting this wrong makes the feature
   feel random even when the model is right.
5. **Can a workflow's layout be edited by hand afterwards, and does that
   stick?** If a routine opens three panels and the user adds a fourth, the
   next run should probably respect that — which makes a workflow's `layout`
   a default rather than a definition, and needs somewhere per-user to store
   the divergence.
6. **What can a workflow put in a panel that isn't a file?** A chart, a diff,
   a list of proposals. Either workflows may contribute ephemeral panel types,
   or there's a generic "result" panel that renders a few known shapes. The
   first is more powerful and much larger.
7. **Does the tree span tabs, or does each tab own one?** Obsidian nests
   splits inside tabs inside splits. That is more expressive and much harder to
   drag correctly, and it's the one place where copying Obsidian wholesale may
   be the wrong call.
