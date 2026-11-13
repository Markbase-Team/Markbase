"use client";

import { intentFromClick, type OpenIntent } from "@markbase/docs/workspace-tabs";

import { useCallback,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { NodeRange } from "@tiptap/extension-node-range";
import Placeholder from "@tiptap/extension-placeholder";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  Bold,
  Check,
  Code,
  GripVertical,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Strikethrough,
  Table as TableIcon,
  Type,
  Unlink,
} from "lucide-react";
import {
  docExtensions,
  SelectAllShortcut,
  docSchema,
  docToMarkdown,
  resolveQuoteToRange,
  commentHighlightRanges,
  type DocJSON,
  type CommentView,
} from "@markbase/docs";
import type * as Y from "yjs";
import { useCrdtSync } from "./use-crdt-sync";
import { YUndo } from "./y-undo";
import { WikiLink } from "./wiki-link";
import { useVaultMedia } from "./use-vault-media";
import { isLocalDocId } from "./local-file-crdt";
import { CommentHighlight, commentHighlightKey } from "./comment-highlight";
import { MermaidBlock } from "./mermaid-block";
import { cn } from "@markbase/ui/utils";
import {
  DocSearchHighlight,
  setSearch,
  stepSearch,
  clearSearch as clearDocSearch,
} from "./doc-search-highlight";
import { SlashCommand } from "./slash-command";
import { MentionCommand } from "./mention-command";
import { useAgentSessions } from "@markbase/ui/use-agent-sessions";
import { PropertiesPanel } from "./properties-panel";
import "./tiptap.css";
import { useLatest } from "@markbase/ui/latest-ref";
import { useDocsPorts } from "./ports";

export type EditorSelection = {
  quote: string;
  from: number;
  to: number;
  version: number;
};

export type SearchStatus = { count: number; index: number };

export type DocEditorHandle = {
  // Scroll to (and briefly flash) the range matching a comment's quoted text.
  // Returns false when the quote can't be found in the current doc.
  scrollToQuote: (quote: string) => boolean;
  // Find-in-document (Cmd+F): highlight matches of `term`, step through them, and
  // clear. Counts/index are 1-based (index 0 = no matches).
  search: (term: string) => SearchStatus;
  findNext: () => SearchStatus;
  findPrev: () => SearchStatus;
  clearSearch: () => void;
};

// WYSIWYG editor on the shared TipTap schema (same extensions client + server).
// Content syncs through the CRDT (doc_crdt snapshot + Realtime deltas), the same
// model the worker's vault syncs, so a browser edit and a local file edit
// converge. Selection → floating BubbleMenu toolbar.
/** The image files in a paste/drop, ignoring the text flavours of the same event. */
function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => f.type.startsWith("image/"));
}

/**
 * Upload each image, then insert it into the document.
 *
 * Inserted as a URL because that is what a browser can paint; the media lens
 * rewrites it to a vault-relative path before it reaches the CRDT. A failed
 * upload inserts nothing — better a missing image than a link that 404s forever
 * in a document the user believes is saved.
 *
 * Images are INLINE nodes (they have to be, so markdown round-trips — see
 * extensions.ts), which means a heading will happily hold one. But a heading is
 * the doc's title, and "paste a screenshot" means "add a picture to the body",
 * never "cram it into the title". So when the cursor sits in a heading, drop the
 * images into their own paragraphs just AFTER it instead of inline within it.
 */
async function insertImages(
  view: EditorView,
  files: File[],
  upload: (f: File) => Promise<string | null>
): Promise<void> {
  const uploaded: Array<{ url: string; alt: string }> = [];
  for (const file of files) {
    const url = await upload(file);
    if (url) uploaded.push({ url, alt: file.name });
  }
  if (uploaded.length === 0) return;

  const { state } = view;
  const imageType = state.schema.nodes.image;
  if (!imageType) return;
  const image = (u: { url: string; alt: string }) => imageType.create({ src: u.url, alt: u.alt });

  const { $from } = state.selection;
  const paragraphType = state.schema.nodes.paragraph;
  if ($from.parent.type.name === "heading" && paragraphType) {
    // One paragraph per image, stacked right after the heading — never in the title.
    const paras = uploaded.map((u) => paragraphType.create(null, image(u)));
    view.dispatch(state.tr.insert($from.after($from.depth), paras).scrollIntoView());
    return;
  }
  // Otherwise insert at the cursor (chaining keeps multiple pastes in order).
  let tr = state.tr;
  for (const u of uploaded) tr = tr.replaceSelectionWith(image(u), false);
  view.dispatch(tr.scrollIntoView());
}

/** Where a document's title came from. Only "heading" may rename the file. */
export type DocTitleSource = "frontmatter" | "heading";

/**
 * The document's title as the editor sees it — the client-side mirror of
 * deriveTitle, and it must stay in step with it.
 *
 * The `source` is the important half. A frontmatter title is the document
 * telling us what it is called, which is worth SHOWING but must never rename the
 * file: a Hexo post named `prometheus-behind-nat-reverse-tunnel.md` declares the
 * title "Prometheus Behind NAT: Scraping Without Open Ports", and letting that
 * drive path-follows-title would rename the file out from under the blog that
 * builds it. Only an h1 the user typed at the top of the document is a rename.
 *
 * A heading anywhere else is a section, not a title. Taking the first heading of
 * any level is what renamed two posts to `The setup.md` and `TL;DR.md`.
 */
function titleOf(doc: PMNode): { title: string; source: DocTitleSource } | null {
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (i === 0 && node.type.name === "frontmatter") {
      const data = node.attrs.data as { title?: string } | null;
      const declared = typeof data?.title === "string" ? data.title.trim() : "";
      if (declared) return { title: declared, source: "frontmatter" };
      continue; // frontmatter without a title — an opening h1 may still name it
    }
    if (node.type.name === "heading" && node.attrs.level === 1) {
      const title = node.textContent.trim();
      return title ? { title, source: "heading" } : null;
    }
    return null; // body content reached; anything later is a section
  }
  return null;
}

export const DocEditor = forwardRef<
  DocEditorHandle,
  {
    docId: string;
    /** Which vault the doc lives in — media resolves against it (roadmap A6). */
    vaultId?: string | null;
    initialDoc: DocJSON;
    /**
     * Markdown to seed the CRDT with when the cloud has no snapshot for this doc
     * yet. NOT the content to display — `initialDoc` is the first frame, and the
     * CRDT overwrites it on bind. These are separate because the API no longer
     * derives display content for the editor (see `?derive=0`).
     */
    seedMarkdown: string;
    editable: boolean;
    /**
     * Who to credit for versions this editor records. Omitted, the history entry
     * says nothing about who wrote it — which is what it did before, and why a
     * file synced up from the vault could be credited to whoever had the doc open.
     */
    author?: string;
    stacked?: boolean;
    onSelectionChange?: (selection: EditorSelection | null) => void;
    /**
     * The document's title changed. `source` says where it came from, and only
     * "heading" may rename the file — see titleOf.
     */
    onTitleChange?: (title: string, source: DocTitleSource) => void;
    /** Follow a `[[wiki-link]]` or a link to another doc — resolve it in the
     *  vault and open it: in this tab on a click, a new one on ⌘/Ctrl-click. */
    onOpenWikiLink?: (target: string, intent: OpenIntent) => void;
  }
>(function DocEditor(
  {
    docId,
    vaultId,
    initialDoc,
    seedMarkdown,
    editable,
    author,
    stacked,
    onSelectionChange,
    onTitleChange,
    onOpenWikiLink,
  },
  ref
) {
  // Images: the CRDT stores vault-relative paths, the editor shows signed URLs.
  const media = useVaultMedia(vaultId ?? null);
  // The editor and its extensions are configured once and then keep running, so
  // everything they call has to be reached through a ref or it goes stale.
  const mediaRef = useLatest(media);
  const onSelectionChangeRef = useLatest(onSelectionChange);
  const onTitleChangeRef = useLatest(onTitleChange);
  const onOpenWikiLinkRef = useLatest(onOpenWikiLink);
  // Where external links go — the browser, or on the desktop the shell, which
  // is the only thing that can follow a `file://` link from an http: page. A
  // ref, because the click handler below is captured once by the editor.
  const linksRef = useLatest(useDocsPorts().links);
  const lastTitleRef = useRef<string | null>(null);

  // The bound doc's Y.UndoManager (from the warm pool), pointed here by
  // useCrdtSync on each bind so YUndo's ⌘Z drives the right doc's stack.
  const undoRef = useRef<Y.UndoManager | null>(null);
  // Re-render on selection so the BubbleMenu's active states stay in sync.
  const [, forceTick] = useState(0);
  const [commentThreads, setCommentThreads] = useState<CommentView[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  // The @mention roster. Guests (share links) get a 401 and an empty list, which
  // the menu renders as "no agent sessions". A file on disk has no API to ask
  // and does not ask.
  const { sessions: agentSessions } = useAgentSessions(!isLocalDocId(docId));
  const agentSessionsRef = useLatest(agentSessions);

  // Named callbacks rather than inline closures: an extension is configured once
  // and reads these later, and pulled out like this it is obvious they are
  // deferred — to a reader and to the lint that checks ref access.
  const getSessions = useCallback(() => agentSessionsRef.current, [agentSessionsRef]);
  const getUndoManager = useCallback(() => undoRef.current, []);
  const navigateWikiLink = useCallback(
    (target: string, intent: OpenIntent) => onOpenWikiLinkRef.current?.(target, intent),
    [onOpenWikiLinkRef]
  );

  const editor = useEditor({
    editable,
    immediatelyRender: false,
    /* eslint-disable react-hooks/refs -- These getters are STORED by configure(),
       not called by it: TipTap merges options into the extension and ProseMirror
       invokes them later, from a keystroke or a suggestion menu. The rule cannot
       see past the call, and reading the ref is the whole point — the extension
       is built once and must not capture the render it was built in. */
    extensions: [
      ...docExtensions,
      Placeholder.configure({
        placeholder: "Write, '/' for blocks, '@' to mention an agent…",
      }),
      SlashCommand,
      // The roster loads async, so hand the suggestion a getter (not a snapshot).
      MentionCommand.configure({ getSessions: getSessions }),
      // NodeRange powers the drag-handle's block selection/reordering.
      NodeRange,
      // …and gives Cmd/Ctrl+A back to an ordinary select-all.
      SelectAllShortcut,
      CommentHighlight,
      // ```mermaid draws as a diagram; its source appears when the cursor is in it.
      MermaidBlock,
      DocSearchHighlight,
      // ⌘Z/⌘⇧Z → the bound doc's Y.UndoManager (PM history is off).
      YUndo.configure({ getManager: getUndoManager }),
      // `[[wiki-link]]` → ⌘/Ctrl+click opens the referenced doc.
      WikiLink.configure({ onNavigate: navigateWikiLink }),
    ],
    /* eslint-enable react-hooks/refs */
    content: initialDoc,
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none min-h-full" },
      /**
       * Copy out as markdown, not as ProseMirror's plain text.
       *
       * The default joins every block with a blank line — `textBetween(from, to,
       * "\n\n")` — so a five-item list pasted elsewhere arrived with a blank line
       * between each item, and headings and emphasis were gone entirely. What is
       * on screen IS markdown here; copying it should hand over the markdown.
       *
       * Serializing a SLICE, not the document: a partial selection cuts nodes
       * open, and `slice.content` is the fragment that survived that cut, which
       * is what the user actually highlighted.
       */
      clipboardTextSerializer: (slice) =>
        docToMarkdown(docSchema.node("doc", null, slice.content)).trim(),
      /**
       * Route a link click: a reference to another document opens that document;
       * anything genuinely external goes to the browser.
       *
       * References inside a vault are relative paths — `[notes](learning/notes.md)`.
       * Handing those to the link extension opened them as URLs, which the browser
       * resolved against the app's origin and Electron then sent to the SYSTEM
       * BROWSER, so following a reference left the app entirely.
       */
      handleClick(_view, _pos, event) {
        const anchor = (event.target as HTMLElement | null)?.closest?.("a");
        const href = anchor?.getAttribute("href");
        if (!href) return false;

        // Same-origin or relative → a reference into the vault. Everything else
        // (another site, mailto:, …) is genuinely external and keeps its
        // behaviour: opened outside, which on the desktop means the browser.
        let internal = false;
        let target = href;
        try {
          const url = new URL(href, window.location.href);
          internal =
            (url.protocol === "http:" || url.protocol === "https:") &&
            url.host === window.location.host;
          if (internal) target = decodeURIComponent(url.pathname).replace(/^\//, "");
        } catch {
          internal = true; // not a URL at all — a bare path
        }

        if (!internal) {
          // Handed to the host rather than `window.open`: a `file://` link
          // points at something on this Mac, and an http: page cannot follow it
          // — the browser refuses, silently, which is exactly what "clicking
          // does nothing" looked like. The desktop's port can; the browser's
          // is window.open, so there the refusal stays the browser's own.
          linksRef.current.openExternal(href);
          event.preventDefault();
          return true;
        }
        event.preventDefault();
        onOpenWikiLinkRef.current?.(target, intentFromClick(event));
        return true;
      },
      // Pasting/dropping an image: ProseMirror would otherwise insert a blob: URL
      // that dies with the tab. Upload instead, and insert the signed URL — the
      // lens rewrites it to `assets/…` on its way into the CRDT, so what
      // persists is a path, not a link to our storage.
      handlePaste(view, event) {
        const files = imageFilesFrom(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(view, files, mediaRef.current.upload);
        return true;
      },
      handleDrop(view, event) {
        const files = imageFilesFrom((event as DragEvent).dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertImages(view, files, mediaRef.current.upload);
        return true;
      },
    },
    onUpdate({ editor: ed }) {
      // Live tab title: frontmatter `title`, else an opening h1 (matches the
      // server's deriveTitle). Keeps the Tabs panel current as the user edits.
      if (onTitleChangeRef.current) {
        const derived = titleOf(ed.state.doc);
        if (derived && derived.title !== lastTitleRef.current) {
          lastTitleRef.current = derived.title;
          onTitleChangeRef.current(derived.title, derived.source);
        }
      }
    },
    onSelectionUpdate({ editor: ed }) {
      forceTick((t) => t + 1);
      const sel = ed.state.selection;
      onSelectionChangeRef.current?.(
        sel.empty
          ? null
          : {
              quote: ed.state.doc.textBetween(sel.from, sel.to, " "),
              from: sel.from,
              to: sel.to,
              // Comments anchor by quoted text, not step positions — version unused.
              version: 0,
            }
      );
    },
  });
  // The imperative handle's methods are called long after the render that made
  // them, so they reach the editor through a ref rather than closing over it.
  const editorRef = useLatest(editor);

  // Bind the editor's content to the CRDT.
  useCrdtSync(
    editor,
    docId,
    seedMarkdown,
    true,
    media.lens,
    media.version,
    author,
    setCommentThreads,
    undoRef
  );

  // On rebind to a different doc (the same editor instance is reused across tab
  // switches), drop the previous doc's comment highlights and title memo at once
  // — the new doc's threads arrive via useCrdtSync's watcher a beat later.
  //
  // Adjusted during render rather than in an effect. The usual answer, a `key`
  // that remounts, is the one thing this surface must not do: reusing the editor
  // across a switch is what makes the switch instant. React's documented
  // alternative is this — compare against the id the state belongs to, and reset
  // on the spot — which re-renders before anything paints instead of showing the
  // old document's comments for a frame first.
  const [threadsDocId, setThreadsDocId] = useState(docId);
  if (threadsDocId !== docId) {
    setThreadsDocId(docId);
    setCommentThreads([]);
  }
  useEffect(() => {
    lastTitleRef.current = null;
  }, [docId, lastTitleRef]);

  // useEditor preserves the editor's CURRENT editability across option changes,
  // so when this reused instance rebinds to a doc of a different capability
  // (e.g. your own doc → a view-only shared doc), push the new value through.
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // CRDT comments (roadmap B1): highlight the unresolved, non-orphaned threads'
  // current text. The threads already carry the live quote (resolved from the
  // relative-position anchor), so resolveQuoteToRange maps it to editor positions
  // — no second coordinate system.
  useEffect(() => {
    if (!editor) return;
    const ranges = commentHighlightRanges(commentThreads, editor.getJSON() as DocJSON);
    editor.view.dispatch(editor.state.tr.setMeta(commentHighlightKey, { ranges }));
  }, [editor, commentThreads]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToQuote: (quote: string) => {
        const ed = editorRef.current;
        if (!ed || !quote) return false;
        const anchor = resolveQuoteToRange(ed.getJSON() as DocJSON, quote);
        if (!anchor) return false;
        const { from, to } = anchor;
        // Flash the range so it's obvious where the comment points.
        ed.view.dispatch(
          ed.state.tr.setMeta(commentHighlightKey, { active: { from, to } })
        );
        const at = ed.view.domAtPos(from);
        const node =
          at.node.nodeType === Node.TEXT_NODE
            ? at.node.parentElement
            : (at.node as HTMLElement);
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(() => {
          const cur = editorRef.current;
          cur?.view.dispatch(
            cur.state.tr.setMeta(commentHighlightKey, { active: null })
          );
        }, 1600);
        return true;
      },
      search: (term: string) => {
        const ed = editorRef.current;
        if (!ed) return { count: 0, index: 0 };
        return setSearch(ed, term);
      },
      findNext: () => {
        const ed = editorRef.current;
        if (!ed) return { count: 0, index: 0 };
        return stepSearch(ed, 1);
      },
      findPrev: () => {
        const ed = editorRef.current;
        if (!ed) return { count: 0, index: 0 };
        return stepSearch(ed, -1);
      },
      clearSearch: () => {
        const ed = editorRef.current;
        if (ed) clearDocSearch(ed);
      },
    }),
    [editorRef]
  );

  return (
    <div className={stacked ? "" : "flex h-full min-h-0 flex-col"}>
      {editor && editable && (
        <BubbleMenu editor={editor} className="flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md">
          {linkOpen ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                applyLink(editor, linkValue);
                setLinkOpen(false);
              }}
            >
              <input
                autoFocus
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setLinkOpen(false);
                }}
                placeholder="https://…"
                className="w-56 rounded bg-transparent px-1.5 py-0.5 text-sm outline-none"
              />
              <TB label="Apply" onClick={() => { applyLink(editor, linkValue); setLinkOpen(false); }}>
                <Check className="size-4" />
              </TB>
              <TB label="Remove link" onClick={() => { editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}>
                <Unlink className="size-4" />
              </TB>
            </form>
          ) : (
            <>
          <TB label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="size-4" />
          </TB>
          <TB label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="size-4" />
          </TB>
          <TB label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough className="size-4" />
          </TB>
          <TB label="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
            <Highlighter className="size-4" />
          </TB>
          <TB label="Code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code className="size-4" />
          </TB>
          <TB
            label="Link"
            active={editor.isActive("link")}
            onClick={() => {
              const href = editor.getAttributes("link").href;
              setLinkValue(typeof href === "string" ? href : "");
              setLinkOpen(true);
            }}
          >
            <Link2 className="size-4" />
          </TB>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <TB label="Normal text" active={editor.isActive("paragraph")} onClick={() => editor.chain().focus().setParagraph().run()}>
            <Type className="size-4" />
          </TB>
          <TB label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 className="size-4" />
          </TB>
          <TB label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="size-4" />
          </TB>
          <span className="mx-0.5 h-4 w-px bg-border" />
          <TB label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="size-4" />
          </TB>
          <TB label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered className="size-4" />
          </TB>
          <TB label="Task list" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
            <ListChecks className="size-4" />
          </TB>
          <TB label="Table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            <TableIcon className="size-4" />
          </TB>
            </>
          )}
        </BubbleMenu>
      )}
      {editor && <PropertiesPanel editor={editor} editable={editable} />}
      {editor && editable && (
        <DragHandle
          editor={editor}
          className="flex cursor-grab items-center rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </DragHandle>
      )}
      <EditorContent
        editor={editor}
        className={
          stacked
            ? "py-2 pl-6 pr-4"
            : "min-h-0 flex-1 overflow-y-auto py-2 pl-6 pr-4 [scrollbar-gutter:stable]"
        }
      />
    </div>
  );
});

function applyLink(editor: Editor, value: string) {
  const href = value.trim();
  const chain = editor.chain().focus().extendMarkRange("link");
  if (href) chain.setLink({ href }).run();
  else chain.unsetLink().run();
}

function TB({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "rounded p-1 hover:bg-muted",
        active ? "bg-muted text-foreground" : "text-muted-foreground"
      )}
    >
      {children}
    </button>
  );
}
