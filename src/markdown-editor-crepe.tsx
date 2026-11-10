"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrompt } from "./prompt-dialog";
import { Crepe } from "@milkdown/crepe";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { commandsCtx, editorViewCtx, type CmdKey } from "@milkdown/kit/core";
import {
  clearTextInCurrentBlockCommand,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  toggleStrikethroughCommand,
  insertTableCommand,
} from "@milkdown/kit/preset/gfm";
import { undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { Ctx } from "@milkdown/kit/ctx";
import { toast } from "sonner";
import {
  Bold,
  Calendar,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  TicketPlus,
  Undo2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "./markdown-editor.css";
import { uploadImages } from "@markbase/protocol/upload";

export interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  /** Namespaces uploaded images in storage (e.g. "diary", a project slug). */
  imagePrefix?: string;
  /**
   * Enables the selection-toolbar "Taskify" button. Given the selected text,
   * the caller creates a ticket and returns its id; the editor then inserts a
   * clickable ticket chip (a link to the board) after the selection. Omit to
   * hide the button (e.g. diary, todo details).
   */
  onTaskify?: (selectedText: string) => Promise<{ id: string } | null>;
}

// ----- Ticket chips ---------------------------------------------------------
// A taskified block links to its ticket via a normal markdown link, so it
// round-trips as plain text: `[#abcdef12](/dashboard?ticket=<uuid>)`. The link
// IS the stored reference; the live status/priority badges are rendered as
// ProseMirror widget decorations (never stored), so they always reflect the
// ticket's current state.

const TICKET_HREF_RE = /[?&]ticket=([0-9a-fA-F-]{36})/;

function ticketIdFromHref(href: string | null | undefined): string | null {
  if (typeof href !== "string") return null;
  const match = href.match(TICKET_HREF_RE);
  return match ? match[1] : null;
}

function ticketHref(id: string): string {
  return `/dashboard?ticket=${id}`;
}

const STATUS_LABELS: Record<string, string> = {
  requested: "Requested",
  ready_to_execute: "Ready",
  in_progress: "In progress",
  review_requested: "In review",
  done: "Done",
};

type ChipData =
  | { kind: "loading" }
  | { kind: "ready"; status: string; priority: string }
  | { kind: "error" };

// The badge cluster shown after a ticket link. A real anchor so a click
// navigates to the ticket even though the badges aren't editor content.
function buildChipBadges(id: string, data: ChipData): HTMLElement {
  const anchor = document.createElement("a");
  anchor.className = "ticket-chip";
  anchor.href = ticketHref(id);
  anchor.contentEditable = "false";
  // Let native navigation happen instead of ProseMirror hijacking the click.
  anchor.addEventListener("mousedown", (e) => e.stopPropagation());

  if (data.kind === "loading") {
    const dot = document.createElement("span");
    dot.className = "ticket-chip__badge ticket-chip__badge--muted";
    dot.textContent = "…";
    anchor.append(dot);
    return anchor;
  }
  if (data.kind === "error") {
    const warn = document.createElement("span");
    warn.className = "ticket-chip__badge ticket-chip__badge--muted";
    warn.textContent = "ticket?";
    anchor.append(warn);
    return anchor;
  }

  const status = document.createElement("span");
  status.className = `ticket-chip__badge ticket-chip__status ticket-chip__status--${data.status}`;
  status.textContent = STATUS_LABELS[data.status] ?? data.status;
  anchor.append(status);

  if (data.priority) {
    const priority = document.createElement("span");
    priority.className = "ticket-chip__badge ticket-chip__priority";
    priority.textContent = data.priority;
    anchor.append(priority);
  }
  return anchor;
}

// A ProseMirror plugin that decorates every `?ticket=<id>` link with live
// status/priority badges. Ticket data is fetched once per id and cached for the
// editor's lifetime; a resolved fetch dispatches an empty transaction to
// re-render.
const ticketChipKey = new PluginKey("work-log-ticket-chips");

function ticketChipPlugin() {
  const cache = new Map<string, ChipData>();
  let activeView: EditorView | null = null;

  function ensureFetched(id: string) {
    if (cache.has(id)) return;
    cache.set(id, { kind: "loading" });
    fetch(`/api/v1/tickets/${id}`, { cache: "no-store" })
      .then(async (res): Promise<ChipData> => {
        if (!res.ok) return { kind: "error" };
        const data: { ticket?: { status?: string }; priority?: string } =
          await res.json();
        return {
          kind: "ready",
          status:
            typeof data.ticket?.status === "string" ? data.ticket.status : "",
          priority: typeof data.priority === "string" ? data.priority : "",
        };
      })
      .catch((): ChipData => ({ kind: "error" }))
      .then((result) => {
        cache.set(id, result);
        if (activeView) {
          activeView.dispatch(activeView.state.tr.setMeta(ticketChipKey, true));
        }
      });
  }

  function decorate(doc: ProseNode): DecorationSet {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const linkMark = node.marks.find((m) => m.type.name === "link");
      if (!linkMark) return;
      const id = ticketIdFromHref(linkMark.attrs.href);
      if (!id) return;
      ensureFetched(id);
      const data = cache.get(id) ?? { kind: "loading" };
      decorations.push(
        Decoration.widget(pos + node.nodeSize, () => buildChipBadges(id, data), {
          side: 1,
          ignoreSelection: true,
        })
      );
    });
    return DecorationSet.create(doc, decorations);
  }

  return new Plugin({
    key: ticketChipKey,
    view: (view) => {
      activeView = view;
      return {
        destroy() {
          activeView = null;
        },
      };
    },
    props: {
      decorations(state) {
        return decorate(state.doc);
      },
    },
  });
}

// Today's date as plain text, e.g. "June 24, 2026". Stays in the markdown.
function formatToday(): string {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Selection → ticket. Reads the selected text, asks the caller to create a
// ticket, then inserts a clickable ticket chip after the selection. Shared by
// the desktop selection toolbar and the mobile action bar.
async function taskifyAction(
  ctx: Ctx,
  create: ((text: string) => Promise<{ id: string } | null>) | undefined
): Promise<void> {
  if (!create) return;
  const view = ctx.get(editorViewCtx);
  const { from, to } = view.state.selection;
  const text = view.state.doc.textBetween(from, to, " ").trim();
  if (!text) {
    toast.error("Select a block of text to taskify");
    return;
  }
  const loading = toast.loading("Creating ticket…");
  try {
    const ticket = await create(text);
    if (!ticket) {
      toast.error("Couldn't create a ticket", { id: loading });
      return;
    }
    const { state } = view;
    const linkType = state.schema.marks.link;
    const href = ticketHref(ticket.id);
    // A plain space (unmarked) then the linked id, so it serializes to a clean
    // `[#abcdef12](…)` rather than wrapping the space in the link.
    const space = state.schema.text(" ");
    const linked = state.schema.text(
      `#${ticket.id.slice(0, 8)}`,
      linkType ? [linkType.create({ href })] : []
    );
    const at = Math.min(state.selection.to, state.doc.content.size);
    view.dispatch(state.tr.insert(at, space).insert(at + 1, linked));
    view.focus();
    toast.success("Ticket created", { id: loading });
  } catch {
    toast.error("Couldn't create a ticket", { id: loading });
  }
}

// A WYSIWYG markdown editor (Milkdown Crepe): live-preview formatting, a slash
// menu, tables, and inline images you can paste / drag / upload — uploads go to
// Supabase Storage via `uploadImages` and render in place. Controlled via the
// same { value, onChange } API as before, so every call site is a drop-in. The
// stored value stays plain markdown.
export default function CrepeMarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 14,
  imagePrefix = "uploads",
  onTaskify,
}: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  // Latest props in refs so the editor is created once and never torn down on a
  // callback identity change.
  const onChangeRef = useRef(onChange);
  const prefixRef = useRef(imagePrefix);
  const onTaskifyRef = useRef(onTaskify);
  // The markdown we last emitted, so external value syncs can skip our own edits.
  const ask = usePrompt();
  const lastMarkdown = useRef(value);
  const readyRef = useRef(false);
  // Whether the editor is focused — drives the always-visible mobile action bar.
  const [focused, setFocused] = useState(false);

  // Keep the latest props in refs (read by the editor's long-lived callbacks).
  useEffect(() => {
    onChangeRef.current = onChange;
    prefixRef.current = imagePrefix;
    onTaskifyRef.current = onTaskify;
  });

  // Create the editor once on mount; tear it down on unmount.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const upload = async (file: File): Promise<string> => {
      const [url] = await uploadImages([file], prefixRef.current);
      return url ?? "";
    };

    // Lucide icons as SVG strings — Crepe's menus take icon markup, not nodes.
    const calendarIcon = renderToStaticMarkup(<Calendar />);
    const taskifyIcon = renderToStaticMarkup(<TicketPlus />);

    const crepe = new Crepe({
      root,
      defaultValue: value,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: placeholder ?? "" },
        [Crepe.Feature.ImageBlock]: {
          onUpload: upload,
          blockOnUpload: upload,
          inlineOnUpload: upload,
        },
        [Crepe.Feature.BlockEdit]: {
          // Add a "Today's date" item to the existing slash (/) menu.
          buildMenu: (builder) => {
            const insert = builder.addGroup("insert", "Insert");
            insert.addItem("today", {
              label: "Today's date",
              icon: calendarIcon,
              onRun: (ctx) => {
                ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
                const view = ctx.get(editorViewCtx);
                view.dispatch(view.state.tr.insertText(formatToday()));
              },
            });
          },
        },
        [Crepe.Feature.Toolbar]: {
          // When taskify is enabled, add a "Taskify" button to the selection
          // toolbar that turns the selected block into a ticket.
          buildToolbar: (builder) => {
            if (!onTaskifyRef.current) return;
            const group = builder.addGroup("taskify", "Taskify");
            group.addItem("taskify", {
              icon: taskifyIcon,
              active: () => false,
              onRun: (ctx) => {
                void taskifyAction(ctx, onTaskifyRef.current);
              },
            });
          },
        },
      },
    });

    // Render live ticket chips on any `?ticket=` link in the content.
    crepe.editor.use($prose(() => ticketChipPlugin()));

    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        lastMarkdown.current = markdown;
        onChangeRef.current(markdown);
      });
    });

    crepeRef.current = crepe;
    let destroyed = false;
    const created = crepe.create().then(() => {
      // React Strict Mode mounts twice in dev. Only mark ready if we're still
      // mounted; the cleanup below owns destruction. Destroying here *as well*
      // double-destroys the editor, which throws
      // `Context "editorState" not found` (and kills the toolbar).
      if (!destroyed) readyRef.current = true;
    });

    return () => {
      destroyed = true;
      readyRef.current = false;
      crepeRef.current = null;
      // Destroy exactly once, after create() settles (destroying mid-create
      // would hit the same missing-context error).
      created.then(() => crepe.destroy()).catch(() => {});
    };
    // Created once: later value/placeholder/prefix changes are handled via refs
    // and the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync an externally-changed value (e.g. switching records) into the editor
  // without rebuilding it. Skip the echoes of our own edits.
  useEffect(() => {
    const crepe = crepeRef.current;
    if (!crepe || !readyRef.current) return;
    if (value === lastMarkdown.current) return;
    lastMarkdown.current = value;
    try {
      crepe.editor.action(replaceAll(value));
    } catch {
      // Editor was torn down between the ready check and here (Strict Mode
      // remount / fast navigation) — the next mount re-seeds from defaultValue.
    }
  }, [value]);

  // Keep the bottom-docked mobile toolbar above the on-screen keyboard. The
  // keyboard shrinks the VisualViewport but not the layout viewport, so a
  // `position: fixed; bottom: 0` bar ends up behind it. Publish the overlap as
  // --kbd-offset; the mobile toolbar CSS reads it as its `bottom`.
  //
  // Set it on <html> (not the editor root) so it reaches the toolbar even if
  // Milkdown portals it outside the editor subtree, and so a `position: fixed`
  // bar (which is viewport-relative) is offset by the right amount.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const docEl = document.documentElement;
    const update = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      docEl.style.setProperty("--kbd-offset", `${overlap}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      docEl.style.removeProperty("--kbd-offset");
    };
  }, []);

  // Track editor focus so the mobile action bar shows only while editing. Focus
  // events bubble (focusin/focusout) to the root; ignore moves that stay inside.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onIn = () => setFocused(true);
    const onOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      if (next instanceof Node && root.contains(next)) return;
      setFocused(false);
    };
    root.addEventListener("focusin", onIn);
    root.addEventListener("focusout", onOut);
    return () => {
      root.removeEventListener("focusin", onIn);
      root.removeEventListener("focusout", onOut);
    };
  }, []);

  // Run an action against the live editor (no-op if it isn't ready / was torn
  // down). `cmd` is the common case: call a Milkdown command by key.
  const run = useCallback((fn: (ctx: Ctx) => void) => {
    const crepe = crepeRef.current;
    if (!crepe || !readyRef.current) return;
    try {
      crepe.editor.action(fn);
    } catch {
      // editor torn down mid-action — ignore
    }
  }, []);
  // Bar buttons are pure DATA: each `action` operates on the editor ctx passed
  // by run() and never reads a ref itself, so the render-phase array isn't
  // ref-tainted (react-hooks/refs). The only ref read is run(), in the onClick.
  const cmd =
    <T,>(key: CmdKey<T>, payload?: T) =>
    (ctx: Ctx) => {
      ctx.get(commandsCtx).call(key, payload);
    };

  const todayAction = (ctx: Ctx) => {
    ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.insertText(formatToday()));
    view.focus();
  };

  const linkAction = async (ctx: Ctx) => {
    // Not window.prompt: Electron throws on it, so inserting a link did nothing
    // at all in the desktop app.
    const href = (await ask({ title: "Link URL", placeholder: "https://…", confirmLabel: "Insert" }))?.trim();
    if (!href) return;
    const view = ctx.get(editorViewCtx);
    const linkType = view.state.schema.marks.link;
    if (!linkType) return;
    const { from, to, empty } = view.state.selection;
    if (empty) {
      const text = view.state.schema.text(href, [linkType.create({ href })]);
      view.dispatch(view.state.tr.insert(from, text));
    } else {
      view.dispatch(view.state.tr.addMark(from, to, linkType.create({ href })));
    }
    view.focus();
  };

  const barButtons: {
    key: string;
    label: string;
    Icon: typeof Bold;
    action: (ctx: Ctx) => void;
  }[] = [
    { key: "undo", label: "Undo", Icon: Undo2, action: cmd(undoCommand.key) },
    { key: "redo", label: "Redo", Icon: Redo2, action: cmd(redoCommand.key) },
    { key: "h1", label: "Heading 1", Icon: Heading1, action: cmd(wrapInHeadingCommand.key, 1) },
    { key: "h2", label: "Heading 2", Icon: Heading2, action: cmd(wrapInHeadingCommand.key, 2) },
    { key: "h3", label: "Heading 3", Icon: Heading3, action: cmd(wrapInHeadingCommand.key, 3) },
    { key: "bold", label: "Bold", Icon: Bold, action: cmd(toggleStrongCommand.key) },
    { key: "italic", label: "Italic", Icon: Italic, action: cmd(toggleEmphasisCommand.key) },
    { key: "strike", label: "Strikethrough", Icon: Strikethrough, action: cmd(toggleStrikethroughCommand.key) },
    { key: "code", label: "Inline code", Icon: Code, action: cmd(toggleInlineCodeCommand.key) },
    { key: "ul", label: "Bullet list", Icon: List, action: cmd(wrapInBulletListCommand.key) },
    { key: "ol", label: "Numbered list", Icon: ListOrdered, action: cmd(wrapInOrderedListCommand.key) },
    { key: "quote", label: "Quote", Icon: Quote, action: cmd(wrapInBlockquoteCommand.key) },
    { key: "table", label: "Table", Icon: Table, action: cmd(insertTableCommand.key) },
    { key: "link", label: "Link", Icon: LinkIcon, action: linkAction },
    { key: "today", label: "Today's date", Icon: Calendar, action: todayAction },
    ...(onTaskify
      ? [
          {
            key: "taskify",
            label: "Taskify",
            Icon: TicketPlus,
            action: (ctx: Ctx) => void taskifyAction(ctx, onTaskify),
          },
        ]
      : []),
  ];

  return (
    <>
      <div
        ref={rootRef}
        className="crepe-editor"
        style={{ "--crepe-min-h": `${rows * 22}px` } as React.CSSProperties}
      />
      {focused &&
        typeof document !== "undefined" &&
        createPortal(
          // Portal to <body> so the bar's `position: fixed` is relative to the
          // viewport (not a transformed ancestor of the editor) — that's what
          // lets --kbd-offset stick it to the top of the keyboard.
          <div className="crepe-mobile-bar" role="toolbar" aria-label="Formatting">
            {barButtons.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-label={b.label}
                title={b.label}
                // Keep the editor focused (and the selection/cursor intact) when
                // a button is tapped — otherwise the bar would blur the editor.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(b.action)}
              >
                <b.Icon className="size-5" />
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
