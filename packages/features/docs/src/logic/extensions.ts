import { JoinAdjacentLists } from "./join-adjacent-lists";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Highlight } from "@tiptap/extension-highlight";
import { Extension, Node, type Extensions } from "@tiptap/core";

// Indent paragraphs/headings with Tab (Shift-Tab outdents). Inside a list, Tab
// still nests the item. The indent is a block attribute rendered as left padding.
// (It lives in doc_json; markdown has no paragraph-indent, so a markdown-mode
// round-trip drops it.)
const MAX_INDENT = 8;
const INDENT_TYPES = ["paragraph", "heading"];

export const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            renderHTML: (attrs) => {
              const level = Number(attrs.indent) || 0;
              return level > 0
                ? { style: `padding-left: ${level * 1.5}rem` }
                : {};
            },
            parseHTML: (el) => {
              const pl = parseFloat(el.style?.paddingLeft || "");
              return Number.isFinite(pl) && pl > 0 ? Math.round(pl / 24) : 0;
            },
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    const shift = (delta: number): boolean => {
      const editor = this.editor;
      if (
        delta > 0 &&
        (editor.commands.sinkListItem("listItem") ||
          editor.commands.sinkListItem("taskItem"))
      ) {
        return true;
      }
      if (
        delta < 0 &&
        (editor.commands.liftListItem("listItem") ||
          editor.commands.liftListItem("taskItem"))
      ) {
        return true;
      }
      return editor.commands.command(({ tr, state, dispatch }) => {
        let changed = false;
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!INDENT_TYPES.includes(node.type.name)) return;
          const cur = Number(node.attrs.indent) || 0;
          const next = Math.min(MAX_INDENT, Math.max(0, cur + delta));
          if (next !== cur) {
            changed = true;
            if (dispatch) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            }
          }
        });
        return changed;
      });
    };
    // Always consume Tab so focus stays in the editor.
    return {
      Tab: () => {
        shift(1);
        return true;
      },
      "Shift-Tab": () => {
        shift(-1);
        return true;
      },
    };
  },
});

// Strike (from StarterKit) only binds `Mod-Shift-s` by default. Add the
// widely-expected `Mod-Shift-x` (⌘⇧X / Ctrl+Shift+X) so it toggles strikethrough
// too. Client-only behaviour; contributes nothing to the schema.
export const StrikeShortcut = Extension.create({
  name: "strikeShortcut",
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
    };
  },
});

// Cmd/Ctrl+A selects the document's text, the way it does everywhere else.
// NodeRange (the drag handle's block selection) binds the same key to a
// block-range selection that hides the native highlight and draws nothing in
// its place, so the key looked dead. The higher priority puts this binding
// ahead of it. Client-only; contributes nothing to the schema.
export const SelectAllShortcut = Extension.create({
  name: "selectAllShortcut",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      "Mod-a": () => this.editor.commands.selectAll(),
    };
  },
});

// Document frontmatter (YAML `---` block) as a single top-of-doc node holding
// the properties object in an attribute. Schema-only here (shared client +
// server); the client attaches a node view that renders the Properties panel.
export const Frontmatter = Node.create({
  name: "frontmatter",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { data: { default: {} } };
  },
  parseHTML() {
    return [{ tag: "div[data-frontmatter]" }];
  },
  renderHTML() {
    return ["div", { "data-frontmatter": "" }];
  },
});

// An @mention of a named agent session. An inline atom so it can't be edited
// apart — you delete the whole chip. `id` is the agent_sessions row it refers to;
// `label` is the name shown at the time it was inserted (kept so the chip still
// reads sensibly if the session is later renamed or deleted).
//
// Markdown round-trip: `[@Label](agent:<id>)` — see markdown.ts. Encoding it as a
// link means any markdown consumer degrades gracefully to readable text.
export const MENTION_HREF_PREFIX = "agent:";

export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { id: { default: null }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      { "data-mention": "", "data-id": String(node.attrs.id ?? "") },
      `@${node.attrs.label}`,
    ];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

// THE shared TipTap extension set. One definition drives the schema on BOTH
// sides: the client editor is configured with these, and the server derives its
// ProseMirror schema from the same list via getSchema() (see schema.ts). Adding
// an extension here changes the schema in lockstep, so steps still apply and
// markdown stays consistent.
//
// StarterKit covers CommonMark (paragraph, heading, lists, blockquote, code,
// codeBlock, hr, hardBreak) plus bold/italic/strike/code marks. We add Link,
// Image, GFM tables, and task lists on top.
export const docExtensions: Extensions = [
  Frontmatter,
  // Side-by-side lists of one kind become one list, as they are in markdown.
  JoinAdjacentLists,
  StarterKit.configure({
    // Link is added explicitly below so we control its options.
    link: false,
    // Undo/redo is handled by the doc's Y.UndoManager (see the YUndo extension),
    // not ProseMirror history — the stack must live on the CRDT so it survives
    // editor rebinds and reverts only the local author's edits. Schema-neutral.
    undoRedo: false,
  }),
  Link.configure({
    // The app routes clicks itself (see DocEditor's handleClick), because a
    // reference to another document in the vault is written as a relative path —
    // `[notes](learning/notes.md)`. Left to the extension, that is opened as a
    // URL: the browser resolves it against the app's origin, and in Electron the
    // window-open handler then sends it to the SYSTEM BROWSER. An internal
    // reference must open the document, not leave the app.
    openOnClick: false,
    autolink: true,
    defaultProtocol: "https",
    // Tiptap validates hrefs too, and `file` is not in its default allow-list —
    // so even once markdown-it produces the link, the mark would be dropped here.
    // Both gates have to agree or the link silently becomes plain text.
    protocols: ["file"],
    HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
  }),
  // Markdown images are INLINE (`text ![a](b.png) more` is legal), but TipTap's
  // Image defaults to a block node. With a block image, prosemirror-markdown
  // can't place markdown-it's inline image token inside a `inline*` paragraph, so
  // ProseMirror dropped the paragraph's whole content — the image AND the text
  // around it. Inline matches markdown and round-trips (roadmap B0 / BUG-1).
  Image.configure({ inline: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight,
  Indent,
  StrikeShortcut,
  Mention,
];
