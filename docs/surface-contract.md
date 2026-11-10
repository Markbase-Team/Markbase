# Phase 1 · The surface contract: how the agent and a content view talk

Status: draft · 2026-09-17 · not started
Companion to [`plugin-system-plan.md`](./plugin-system-plan.md) and
[`reader-plugin-refactor-and-mobile.md`](./reader-plugin-refactor-and-mobile.md).

The agent column sits beside whatever is in the content pane. For that to be
worth anything, the two have to talk: the view says what the user is looking
at and what they've selected, and the agent can point back at it. Today that
conversation exists, but it is implicit, lossy and markdown-only. This doc
names it — the **surface contract** — and says what it should be before a
second content kind (a PDF) and third-party views arrive.

A *surface* is whatever a content view is showing in the workspace's content
slot: a markdown document, a PDF, later a CSV or an image. The contract has
three parts: what a surface **provides** to the agent, what it **accepts**
from the agent, and what it **declares** so both sides know which of those to
expect.

---

## What exists today

Selection already flows from the editor to the agent, through four hops:

1. `DocEditor` produces `EditorSelection = { quote, from, to, version }`.
2. `DocView` reports it up: `onAgentSelection(docId, sel)`.
3. `docs-workspace` holds it as `agentSel` and hands the active document's
   selection to the dock.
4. `AgentChatDock` shows it as a removable composer chip, and on send prepends
   `selectionContext()` — a markdown blockquote, tagged with the file path.

In the other direction there is exactly one thing: file-path-shaped inline
code in the agent's output becomes a clickable jump via `onOpenFile`.

It works, and the parts worth keeping are the parts that were designed:
context is *offered* rather than silently attached, the user can drop it, and
the framing that reaches the model is plain prose.

Four things are wrong with it as a contract:

- **It's lossy at the dock boundary.** The dock's prop type is `selection?: {
  quote: string } | null`, so `from`, `to` and `version` are dropped. The
  agent can talk about a passage but cannot point at it. `scrollToQuote`
  exists on `DocEditorHandle` and has to re-find the text by searching for it.
- **It's prose all the way down.** The selection reaches the model as English.
  There's nowhere to put a page number, and a cropped image region isn't text
  at all — which is why the reader's area selection bypasses this path
  entirely and posts a vision payload to its own endpoint.
- **It's push-only.** The view pushes a selection when there is one. The agent
  cannot ask what's on screen, so "summarize this page" has nothing to work
  with, because nothing reports the current page.
- **It's one view's private arrangement.** Every hop names documents
  (`onAgentSelection(docId, …)`, `agentSel.docId`). A second content kind has
  to either impersonate a document or build its own parallel path — which is
  what the reader did.

## The contract

### 1 · Context: what a surface provides

```ts
/** What the active content view is showing, offered to the agent. */
interface SurfaceContext {
  surface: { kind: string; id: string; title: string; path?: string };
  /** Where the user is, selection or not. */
  locus?: { page: number } | { heading: string } | { line: number };
  selection?: SurfaceSelection | null;
}

interface SurfaceSelection {
  /** The handle: how to find this again later. */
  anchor: Anchor;
  /** The payload: what the model reads. Present whenever the selection is text. */
  quote?: string;
  /** A non-text selection (a cropped region) resolves to an asset instead. */
  image?: { assetPath: string; mime: string };
  /** One line, for the composer chip. */
  label: string;
}
```

`Anchor` is the union the reader refactor introduces — a CRDT relative
position for text that moves, a page plus normalized rects for a PDF, which
doesn't:

```ts
type Anchor =
  | { kind: "crdt"; from: number[]; to: number[]; quote: string }
  | { kind: "page"; page: number; rects: Rect[]; quote: string };
```

**The quote is the payload; the anchor is the handle. Both travel.** That is
the one change that unblocks everything else: an agent that holds the anchor
can point back at the exact passage instead of searching for its text.

`locus` is the fix for push-only. A surface reports where the user is whether
or not they've selected anything, so "what's this page about" works.

### 2 · Commands: what a surface accepts

```ts
interface SurfaceCommands {
  /** The surface's content, whole or in a range. Text, whatever the bytes are. */
  read(range?: { from: number; to: number }): Promise<{ text: string; truncated: boolean }>;
  /** Scroll to an anchor and flash it. False when the anchor is gone. */
  reveal(anchor: Anchor): Promise<boolean>;
  /** Mark a span. Returns the highlight's id. */
  highlight(anchor: Anchor, opts?: { color?: string; note?: string }): Promise<string>;
  /** Open something else — generalizes today's onOpenFile. */
  open(target: { kind: string; id: string }, intent: OpenIntent): Promise<void>;
  /** Write at an anchor. Only surfaces whose content is editable accept this. */
  insert(anchor: Anchor, content: string): Promise<void>;
}
```

That a PDF accepts `reveal` and `highlight` but not `insert`, while markdown
accepts all four, is a good sign the split is on a real joint: a PDF's bytes
are immutable, and the annotations live beside it.

`open` generalizes the one reverse channel that exists. It should keep the
behaviour that already works — a plain click follows in the current tab,
`⌘`-click opens a new one — by taking the same `OpenIntent` the tab reducer
already uses.

### 3 · Declaration: what a view says about itself

```ts
contributes: {
  views: [{
    id: "reader.pdf",
    contentKinds: ["application/pdf"],
    surface: {
      provides: ["content", "selection.text", "selection.region", "locus.page"],
      accepts:  ["read", "reveal", "highlight", "open"],
    },
  }],
}
```

Declaring it statically means three things follow without running plugin code:
the agent is told which commands exist rather than discovering them by
failing, the composer can show the right affordances for the surface in front
of it, and whoever installs a third-party view can see what it will hand to
the agent before they approve it.

### Reading the whole surface

**Decided: the agent gets read access to the whole surface, not only the
selection.** "Summarize this" and "does this contradict page 4" are the
obvious asks, and the alternative — the agent knowing only what you
highlighted — makes the panel feel blind next to a document it could have
read from the vault anyway.

Three things follow, and they are the actual work:

- **A PDF has to produce text.** Markdown is already text; a PDF is not.
  pdf.js can extract per page in the view that already has the document open,
  which keeps it where the bytes are and costs nothing extra. A scanned PDF
  produces nothing that way and needs OCR, which is a different capability and
  should fail honestly (`truncated`, empty text) rather than silently return
  half a document.
- **`read` has a range because surfaces don't fit.** A 400-page PDF is not
  going into a context window. The range is the contract's admission of that,
  and `truncated` is how the agent learns it only got part. `locus` is what
  makes a bare `read()` sensible on a long surface — read around where the
  user is.
- **It's a pull, so it's a permission, not a chip.** The selection chip works
  because the user is offering something in the moment. Whole-surface read
  happens when the agent decides it needs it, so consent moves to install
  time: `surface:read` covers the selection, `surface:content` covers pulling
  the whole thing, and a third-party view's `provides: ["content"]` is a
  disclosure the person installing it should see.

## Rules

- **Context is offered, not sent.** The composer chip stays: the user sees
  what's attached and can drop it before sending. This is a privacy property
  of the contract, not a UI detail of one dock, and every surface inherits it.
- **One active surface.** The agent sees the focused panel and nothing else;
  background tabs and unfocused panels don't leak. Today that's the active
  tab, because there is one content slot; under
  [`workspace-layout.md`](./workspace-layout.md) it becomes the focused leaf,
  and an agent panel may be pinned to a specific one instead of following
  focus.
- **Stale is a normal outcome, not an error.** `EditorSelection.version`
  exists for a reason and `scrollToQuote` already returns `false`. A command
  against an anchor whose text is gone fails cleanly and says so; it never
  guesses at the nearest match.
- **Prose is a rendering, not the transport.** Keep `selectionContext()`'s
  blockquote — it works — but generate it from the structure, so a PDF
  selection renders as "from page 12 of `papers/attention.pdf`" and a region
  selection attaches its image, with no second endpoint.
- **Commands are tool calls.** They go through the plugin plan's existing
  pipeline — `tools/pre-execute` → approval → `tools/execute` →
  `tools/post-execute` — rather than inventing a second path. `reveal` is
  harmless and auto-approves; `insert` is a write and takes the same approval
  as any other edit the agent makes.
- **Three permissions.** `surface:read` to see the selection and locus,
  `surface:content` to pull the whole surface, `surface:write` to issue
  commands that change something. A view's `provides` list is a declaration of
  what it will hand to an agent, and an install-time question for the person
  approving it.

## `insert`: write directly, or propose?

This is the one command that changes the user's content, and the codebase has
no answer between two extremes. The agent's write API is:

| | What it does |
|---|---|
| `POST /docs/:id/edits` | Applies `quote → insert` **immediately**. New version, in the CRDT, visible to collaborators at once. Its summary: *"the only way to change a doc"*. |
| `POST /docs/:id/comments` | Changes nothing. Anchored to text with `quotedText`. |

The skill text encodes the fork: comment *"when you have a real question or a
suggestion you shouldn't just apply."* So the agent's own instructions send it
to comments precisely when a proposal would be the right shape — because a
proposal isn't available.

There is no middle tier. `anchor.ts` opens by calling itself "the review-layer
foundation: agent suggestions and human comments both anchor this way", and
only the comments half was ever built. Undo for an applied edit is
`restoreDoc`, which reverts a whole version, not one change.

The surface contract makes this sharper than the API does, because of *where*
it happens. `/edits` is what a background agent uses — you come back and find
a new version. `insert` from the agent column lands in the pane you are
looking at, possibly under your cursor, and the CRDT pushes it to
collaborators the same instant.

**Recommendation: `insert` proposes. It never writes.**

- The plugin plan already picked this side for workflows — "writes become
  proposals (suggested edits, draft messages) applied after policy or
  approval." Two different answers to "the agent changed my document" is worse
  than either answer alone.
- The anchor layer was built for it and is sitting unused.
- It is reversible in the right unit: rejecting a proposal drops one change,
  where `restoreDoc` throws away a version.
- The only surface that accepts `insert` is the editable one, so the diff UI
  has exactly one place to live. A PDF's `accepts` list doesn't include it.

The cost is real and worth stating: a proposal tier means accept/reject UI
that doesn't exist, and for a "fix this typo" the user just asked for out
loud, the extra click is friction. That's what the tool pipeline is for —
`tools/pre-execute` → approval → `tools/execute` can auto-approve an insert
the user explicitly asked for and hold back one the agent volunteered, without
the contract needing two kinds of `insert`.

## Why this matters more than it looks

**It's what makes content views worth contributing.** A third-party view that
can't talk to the agent is inert next to the one column users care about. The
plugin plan's `contributes.views` isn't worth much until a contributed view
can participate in this.

**It's what makes the reader good rather than merely moved.** The reader's
current Q&A is a one-shot `chatJson` call with the quoted passage as its
entire context. Under this contract the same selection reaches a live session
that also knows the page, the vault and the file — and can highlight its
answer back onto the page it came from.

**It's what makes two screens feel like one app.** On a dual-screen device
the agent is physically on the other side of the hinge from the content. Every
`reveal` crosses it. Without the contract, the second screen is a chat window
that happens to be nearby; with it, the two panes are one workspace.

## Phasing

| Step | Change | Depends on |
|---|---|---|
| S1 | Stop dropping the anchor at the dock boundary; widen the dock's `selection` prop to carry it | nothing |
| S2 | Name the types (`SurfaceContext`, `SurfaceSelection`, `Anchor`, `SurfaceCommands`) and rewrite today's document path in terms of them, behaviour unchanged | S1 |
| S3 | Report `locus`, so "this page" / "this section" works with nothing selected | S2 |
| S4 | `reveal` and `highlight` as agent tools, through the tool pipeline | S2, plan Phase 3 |
| S4b | `read` with a range, markdown first; `surface:content` as its own permission | S3 |
| S5 | The PDF surface implements the contract; the reader's `/ask` endpoint and Questions panel are deleted | S4, reader R2 |
| S6 | `surface` in `contributes.views`, with the three permissions | S5, plan Phase 2 |
| S7 | `insert` as a proposal, with the accept/reject UI that implies | S4, and a decision on open question 3 |

S1 and S2 are small and worth doing before the reader refactor starts, because
they decide the shape the PDF surface is built against.

## Open questions

1. **Multi-select.** Several passages as one context is natural for reading and
   for review, and it changes `selection` from a value to a list. Cheaper to
   decide now than to widen later.
2. **Does `highlight` write a comment or a highlight?** The reader refactor
   makes a highlight a comment with no body. If the agent's highlights are
   comments, they show up in the comments panel and in the doc's history,
   which is probably right and is definitely a bigger commitment.
3. **Who renders a proposal?** Given the recommendation above, something has to
   draw the diff and own accept/reject. Whether that's a fourth panel tab, an
   inline treatment in the editor, or a comment with a patch attached is
   undecided, and it is the piece of real UI this contract creates.
4. **Does whole-surface read cover a scanned PDF?** OCR is a separate
   capability with a real cost, and "the agent can read this PDF" quietly
   meaning "unless it's a scan" is the kind of gap that surprises people.
