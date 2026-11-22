import { Node, Fragment } from "@tiptap/pm/model";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import MarkdownIt from "markdown-it";
import markdownItMark from "markdown-it-mark";
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
  type MarkdownSerializerState,
} from "prosemirror-markdown";
import { docSchema } from "./schema";
import { MENTION_HREF_PREFIX } from "./extensions";
import type { DocJSON, JSONValue } from "./types";

// A leading YAML frontmatter block: --- ... --- at the very top.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Markdown <-> ProseMirror for the TipTap schema, headless (markdown-it +
// prosemirror-markdown machinery), so it runs the same on the client and the
// server. Node/mark names are TipTap's (camelCase), and GFM (strikethrough,
// tables, task lists) is handled on top of CommonMark.

// ---- Serializer (doc -> markdown) ------------------------------------------

function backticksFor(node: Node, side: number): string {
  const ticks = /`+/g;
  let match: RegExpExecArray | null;
  let len = 0;
  if (node.isText && node.text) {
    while ((match = ticks.exec(node.text))) len = Math.max(len, match[0].length);
  }
  let result = len > 0 && side > 0 ? " `" : "`";
  for (let i = 0; i < len; i++) result += "`";
  if (len > 0 && side < 0) result += " ";
  return result;
}

const serializer = new MarkdownSerializer(
  {
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write(state.repeat("#", node.attrs.level) + " ");
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },
    codeBlock(state, node) {
      const lang =
        typeof node.attrs.language === "string" ? node.attrs.language : "";
      state.write("```" + lang + "\n");
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write("```");
      state.closeBlock(node);
    },
    horizontalRule(state, node) {
      state.write("---");
      state.closeBlock(node);
    },
    bulletList(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    orderedList(state, node) {
      const start =
        typeof node.attrs.start === "number" ? node.attrs.start : 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = state.repeat(" ", maxW + 2);
      state.renderList(node, space, (i: number) => {
        const nStr = String(start + i);
        return state.repeat(" ", maxW - nStr.length) + nStr + ". ";
      });
    },
    listItem(state, node) {
      state.renderContent(node);
    },
    taskList(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    taskItem(state, node) {
      state.write(node.attrs.checked ? "[x] " : "[ ] ");
      state.renderContent(node);
    },
    table(state, node) {
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(cell.textContent.trim()));
        rows.push(cells);
      });
      if (rows.length === 0) return;
      const [header, ...body] = rows;
      state.write("| " + header.join(" | ") + " |\n");
      state.write("| " + header.map(() => "---").join(" | ") + " |\n");
      for (const r of body) state.write("| " + r.join(" | ") + " |\n");
      state.closeBlock(node);
    },
    tableRow() {},
    tableHeader() {},
    tableCell() {},
    image(state, node) {
      const alt = state.esc(String(node.attrs.alt ?? ""));
      const src = String(node.attrs.src ?? "");
      const title = node.attrs.title
        ? ' "' + String(node.attrs.title).replace(/"/g, '\\"') + '"'
        : "";
      state.write(`![${alt}](${src}${title})`);
    },
    hardBreak(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write("\\\n");
          return;
        }
      }
    },
    // `[@Label](agent:<id>)` — a plain link, so any markdown reader degrades to
    // readable text. Strip `]`/newlines from the label so the link can't break.
    mention(state, node) {
      const label = String(node.attrs.label ?? "").replace(/[\]\r\n]/g, "");
      const id = encodeURIComponent(String(node.attrs.id ?? ""));
      state.write(`[@${label}](${MENTION_HREF_PREFIX}${id})`);
    },
    text(state, node) {
      state.text(node.text ?? "", false);
    },
  },
  {
    bold: defaultMarkdownSerializer.marks.strong,
    italic: defaultMarkdownSerializer.marks.em,
    strike: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    highlight: {
      open: "==",
      close: "==",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    link: defaultMarkdownSerializer.marks.link,
    code: {
      open(_state: MarkdownSerializerState, _mark, parent, index) {
        return backticksFor(parent.child(index), -1);
      },
      close(_state: MarkdownSerializerState, _mark, parent, index) {
        return backticksFor(parent.child(index - 1), 1);
      },
      escape: false,
    },
  }
);

// ---- Parser (markdown -> doc) ----------------------------------------------

const md = MarkdownIt("commonmark", { html: false })
  .enable(["table", "strikethrough"])
  .use(markdownItMark);

/**
 * Allow `file:` links; keep refusing the ones that can execute.
 *
 * markdown-it's default validateLink rejects `vbscript:`, `javascript:`, `file:`
 * and non-image `data:` alike. Lumping `file:` in with the script protocols
 * costs a real feature: a vault holds notes ABOUT documents that live elsewhere
 * — a passport scan in iCloud Drive, a PDF in Downloads — and a checklist of
 * them is worth nothing if the entries aren't links. They were not merely
 * unclickable; the mark was never created, so `[name](file://…)` rendered as its
 * literal markdown source.
 *
 * `javascript:` and `vbscript:` stay refused: those execute in the page, which is
 * a different kind of thing entirely from naming a file on disk. Opening what a
 * file: link points at is guarded separately, where it belongs — the desktop
 * shell refuses anything macOS would run rather than open.
 */
const EXECUTABLE_PROTO = /^(vbscript|javascript):/;
const DATA_IMAGE = /^data:image\/(gif|png|jpeg|webp);/;
md.validateLink = (url: string): boolean => {
  const link = url.trim().toLowerCase();
  if (EXECUTABLE_PROTO.test(link)) return false;
  if (link.startsWith("data:")) return DATA_IMAGE.test(link);
  return true;
};

// TipTap table cells are block-level (they contain paragraphs), but markdown-it
// puts inline content directly inside th/td. Wrap each cell's content in a
// paragraph so it fits the schema.
md.core.ruler.push("wrap_table_cells", (state) => {
  const out: (typeof state.tokens)[number][] = [];
  for (const tok of state.tokens) {
    if (tok.type === "th_close" || tok.type === "td_close") {
      out.push(new state.Token("paragraph_close", "p", -1));
    }
    out.push(tok);
    if (tok.type === "th_open" || tok.type === "td_open") {
      out.push(new state.Token("paragraph_open", "p", 1));
    }
  }
  state.tokens = out;
  return true;
});

const parser = new MarkdownParser(docSchema, md, {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "listItem" },
  bullet_list: { block: "bulletList" },
  ordered_list: {
    block: "orderedList",
    getAttrs: (tok) => ({ start: Number(tok.attrGet("start") ?? 1) || 1 }),
  },
  heading: {
    block: "heading",
    getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }),
  },
  code_block: { block: "codeBlock", noCloseToken: true },
  fence: {
    block: "codeBlock",
    getAttrs: (tok) => ({ language: tok.info || null }),
    noCloseToken: true,
  },
  hr: { node: "horizontalRule" },
  image: {
    node: "image",
    getAttrs: (tok) => ({
      src: tok.attrGet("src"),
      title: tok.attrGet("title") || null,
      alt: (tok.children?.[0] && tok.children[0].content) || null,
    }),
  },
  hardbreak: { node: "hardBreak" },
  // GFM tables. thead/tbody are structural wrappers with no schema node.
  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "tableRow" },
  th: { block: "tableHeader" },
  td: { block: "tableCell" },
  em: { mark: "italic" },
  strong: { mark: "bold" },
  s: { mark: "strike" },
  mark: { mark: "highlight" },
  link: {
    mark: "link",
    getAttrs: (tok) => ({
      href: tok.attrGet("href"),
      title: tok.attrGet("title") || null,
    }),
  },
  code_inline: { mark: "code", noCloseToken: true },
});

// ---- Public API ------------------------------------------------------------

// markdown-it (CommonMark) parses "- [ ] todo" as a normal bullet item with the
// literal text "[ ] todo". Convert bullet lists whose items are all checkboxes
// into interactive taskList/taskItem nodes, stripping the "[ ] "/"[x] " prefix.
// The trailing \s+ is optional because an EMPTY checkbox has nothing after it.
// docToMarkdown writes one as "- [ ] " and markdown-it strips that trailing
// space, leaving the item's text as exactly "[ ]". Requiring whitespace there
// meant a checkbox you had not typed into yet failed to parse back — and since
// a list only becomes a taskList when EVERY item is one, a single empty box
// turned the whole list, filled items and all, into plain bullets showing the
// literal text "[ ]". GitHub renders a bare "- [ ]" as an empty checkbox too.
const TASK_RE = /^\[([ xX])\](\s+|$)/;

function isTaskItem(item: Node): boolean {
  if (item.type.name !== "listItem") return false;
  const para = item.firstChild;
  return (
    !!para && para.type.name === "paragraph" && TASK_RE.test(para.textContent)
  );
}

function stripPrefix(paragraph: Node, count: number): Node {
  const content: Node[] = [];
  let removed = 0;
  paragraph.forEach((child) => {
    if (removed < count && child.isText && child.text) {
      const take = Math.min(count - removed, child.text.length);
      removed += take;
      const rest = child.text.slice(take);
      if (rest) content.push(docSchema.text(rest, child.marks));
    } else {
      content.push(child);
    }
  });
  return paragraph.copy(Fragment.fromArray(content));
}

function toTaskItem(item: Node): Node {
  const para = item.firstChild;
  const match = para ? para.textContent.match(TASK_RE) : null;
  if (!para || !match) return item;
  const checked = match[1].toLowerCase() === "x";
  const rest: Node[] = [stripPrefix(para, match[0].length)];
  item.forEach((child, _offset, index) => {
    if (index > 0) rest.push(child);
  });
  return docSchema.node("taskItem", { checked }, rest);
}

function transformTaskLists(node: Node): Node {
  if (node.isText || node.isLeaf) return node;
  const children: Node[] = [];
  node.forEach((child) => children.push(transformTaskLists(child)));
  if (
    node.type.name === "bulletList" &&
    children.length > 0 &&
    children.every(isTaskItem)
  ) {
    return docSchema.node("taskList", null, children.map(toTaskItem));
  }
  return node.copy(Fragment.fromArray(children));
}

// The editor keeps a trailing paragraph so the cursor can rest after the last
// block. If parsed markdown ends in a list/table/heading/etc., the editor would
// append one on load and commit a spurious no-op version — so we append it here,
// making the loaded doc stable. docToMarkdown drops trailing empty paragraphs,
// so the markdown itself stays clean.
function ensureTrailingParagraph(doc: Node): Node {
  if (doc.lastChild?.type.name === "paragraph") return doc;
  const children: Node[] = [];
  doc.forEach((child) => children.push(child));
  children.push(docSchema.node("paragraph"));
  return docSchema.node("doc", null, children);
}

// Markdown has no mention node, so `[@Label](agent:<id>)` parses back as a link.
// Lift those into real `mention` atoms, mirroring the serializer, so a doc
// survives a markdown round-trip with its mentions intact.
function liftMentions(node: Node): Node {
  if (node.isText) {
    const link = node.marks.find((m) => m.type.name === "link");
    const href = typeof link?.attrs.href === "string" ? link.attrs.href : "";
    if (!href.startsWith(MENTION_HREF_PREFIX)) return node;
    const id = decodeURIComponent(href.slice(MENTION_HREF_PREFIX.length));
    const label = (node.text ?? "").replace(/^@/, "");
    return docSchema.node("mention", { id, label });
  }
  if (node.childCount === 0) return node;
  const children: Node[] = [];
  node.forEach((child) => children.push(liftMentions(child)));
  return node.copy(Fragment.fromArray(children));
}

export function markdownToDoc(markdown: string): Node {
  // Same splitter deriveTitle uses, so the title a document shows and the
  // frontmatter node it renders can never disagree about where the body starts.
  const { frontmatter, body } = splitFrontmatter(markdown);

  const parsed = parser.parse(body);
  if (!parsed) throw new Error("Failed to parse markdown");
  let doc = liftMentions(transformTaskLists(parsed));

  if (frontmatter) {
    const fmNode = docSchema.node("frontmatter", { data: frontmatter });
    const children: Node[] = [fmNode];
    doc.forEach((child) => children.push(child));
    doc = docSchema.node("doc", null, children);
  }
  return ensureTrailingParagraph(doc);
}

/**
 * Write lists tight — one line per item, no blank line between them.
 *
 * prosemirror-markdown decides this from `node.attrs.tight`, falling back to
 * this option. TipTap's list nodes carry no such attribute, so every list was
 * written loose:
 *
 *     - one          becomes      - one
 *     - two                       <blank>
 *     - three                     - two
 *                                 <blank>
 *                                 - three
 *
 * That is not a formatting preference, it is the file changing under the user.
 * Every list in every document grew blank lines on the way back to disk, and
 * again on every save after that.
 *
 * The cost: a list the author wrote LOOSE, deliberately, comes back tight. That
 * distinction is already gone by this point — the schema has no attribute to
 * carry it, so the parser drops it — and between mangling the common case and
 * flattening the rare one, tight is the honest default. Keeping looseness would
 * mean a `tight` attribute on the list nodes, which changes stored doc_json.
 */
const SERIALIZE_OPTIONS = { tightLists: true } as const;

export function docToMarkdown(doc: Node): string {
  const first = doc.firstChild;
  if (first && first.type.name === "frontmatter") {
    const data = (first.attrs.data ?? {}) as Record<string, JSONValue>;
    const bodyChildren: Node[] = [];
    doc.forEach((child, _offset, index) => {
      if (index > 0) bodyChildren.push(child);
    });
    const body = serializer.serialize(docSchema.node("doc", null, bodyChildren), SERIALIZE_OPTIONS);
    if (Object.keys(data).length === 0) return body;
    return `---\n${yamlDump(data).trimEnd()}\n---\n\n${body}`;
  }
  return serializer.serialize(doc, SERIALIZE_OPTIONS);
}

// Serialize a stored doc_json straight to markdown — for exports/downloads —
// so callers don't need prosemirror. Returns "" if the JSON doesn't parse
// under the current schema (same guard as docJsonIsValid).
export function docJsonToMarkdown(docJson: DocJSON): string {
  try {
    return docToMarkdown(Node.fromJSON(docSchema, docJson));
  } catch {
    return "";
  }
}

// A valid empty document (one empty paragraph) — the starting state for a
// brand-new doc.
export function emptyDoc(): Node {
  return docSchema.node("doc", null, [docSchema.node("paragraph")]);
}

/**
 * The document's title, or null when it has none yet (callers fall back to the
 * filename).
 *
 * Order matters, and the previous rule — "the first heading of any level,
 * anywhere" — was wrong in a way that destroyed files. A Hexo post carries its
 * real title in YAML frontmatter and its first markdown heading is an `##`
 * twenty lines down: `## TL;DR`, `## The setup`. Because the title renames the
 * file (path-follows-title), editing such a post renamed
 * `prometheus-behind-nat-reverse-tunnel.md` to `The setup.md` and moved the
 * original to .trash. Two posts were retitled to a section heading of their own
 * body that way, and two of them collided on `TL;DR.md`.
 *
 * So: the frontmatter's `title` wins, because a document that states its own
 * title is not guessing. Failing that, only a LEADING h1 counts — a heading that
 * is the first thing in the body, which is what "the title of this document"
 * looks like in a Markbase-native doc. A heading buried in the body is a
 * section, never a title.
 */
export function deriveTitle(markdown: string): string | null {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const declared = frontmatter?.title;
  if (typeof declared === "string" && declared.trim()) return declared.trim();
  return leadingH1(body);
}

/**
 * Has this document never been given a name?
 *
 * The dividing line for automatic titling. A document that already carries a name
 * — because a file declared it, because a filename supplied it, or because someone
 * typed it — has been named, and deriving a fresh title for it means overwriting a
 * decision that was already made. Only a document with nothing to overwrite is
 * safe to name automatically.
 */
export function isUntitled(title: string | null | undefined): boolean {
  const trimmed = (title ?? "").trim();
  return trimmed === "" || trimmed.toLowerCase() === "untitled";
}

/**
 * An h1 that opens the document, or null. The FIRST non-blank line has to be it:
 * once any other content has appeared, a later heading is a section of the body.
 */
export function leadingH1(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^\s{0,3}#\s+(.+?)\s*$/);
    return match ? match[1].trim() || null : null;
  }
  return null;
}

/**
 * The markdown with its leading h1 reading `title`, or unchanged when there is
 * no leading h1 — a document without one is not given one, since the heading is
 * the author's to write. The counterpart of leadingH1: a rename made in the
 * sidebar reaches the heading, the way a heading typed in the body reaches the
 * sidebar.
 */
export function retitleLeadingH1(markdown: string, title: string): string {
  const next = title.trim();
  if (!next) return markdown;
  const fm = markdown.match(FRONTMATTER_RE);
  const head = fm ? fm[0] : "";
  const body = markdown.slice(head.length);
  const lines = body.split(/(\r?\n)/);
  for (let i = 0; i < lines.length; i += 2) {
    if (!lines[i].trim()) continue;
    const match = lines[i].match(/^(\s{0,3}#\s+)(.+?)(\s*)$/);
    if (!match || match[2] === next) return markdown;
    lines[i] = `${match[1]}${next}${match[3]}`;
    return head + lines.join("");
  }
  return markdown;
}

/**
 * Split a leading YAML frontmatter block off the body. Malformed YAML yields no
 * frontmatter and an untouched body — leave it in the text rather than lose it.
 */
export function splitFrontmatter(markdown: string): {
  frontmatter: Record<string, JSONValue> | null;
  body: string;
} {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: null, body: markdown };
  try {
    const parsed = yamlLoad(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        frontmatter: parsed as Record<string, JSONValue>,
        body: markdown.slice(match[0].length),
      };
    }
  } catch {
    // malformed frontmatter — leave it in the body rather than lose it
  }
  return { frontmatter: null, body: markdown };
}

// Whether a stored doc_json parses under the current schema. Used to guard docs
// created before a schema change (their JSON uses old node names).
export function docJsonIsValid(docJson: DocJSON): boolean {
  try {
    Node.fromJSON(docSchema, docJson);
    return true;
  } catch {
    return false;
  }
}
