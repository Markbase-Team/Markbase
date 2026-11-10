import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Find-in-document: a ProseMirror decoration plugin that highlights every
// occurrence of a search term and emphasises the "current" one, plus helpers the
// editor's imperative handle drives from the Cmd+F find bar.

export type Match = { from: number; to: number };
type SearchState = { term: string; matches: Match[]; index: number };
export type SearchStatus = { count: number; index: number };

const searchKey = new PluginKey<SearchState>("docSearch");

/** All case-insensitive occurrences of `term`, as ProseMirror ranges. Matches
 *  within a single text run (a match split across mark boundaries is skipped —
 *  rare, and cheap to live without). */
function findMatches(doc: PMNode, term: string): Match[] {
  const needle = term.toLowerCase();
  if (!needle) return [];
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    const text = node.text.toLowerCase();
    let i = text.indexOf(needle);
    while (i !== -1) {
      out.push({ from: pos + i, to: pos + i + needle.length });
      i = text.indexOf(needle, i + needle.length);
    }
    return true;
  });
  return out;
}

export const DocSearchHighlight = Extension.create({
  name: "docSearch",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ term: "", matches: [], index: 0 }),
          apply(tr: Transaction, prev: SearchState): SearchState {
            const meta = tr.getMeta(searchKey) as
              | { term: string }
              | { index: number }
              | undefined;
            if (meta && "term" in meta) {
              const matches = findMatches(tr.doc, meta.term);
              return { term: meta.term, matches, index: matches.length ? 0 : -1 };
            }
            if (meta && "index" in meta) {
              return { ...prev, index: meta.index };
            }
            // Keep highlights honest as the doc changes underneath a live search.
            if (tr.docChanged && prev.term) {
              const matches = findMatches(tr.doc, prev.term);
              const index = matches.length
                ? Math.min(Math.max(prev.index, 0), matches.length - 1)
                : -1;
              return { ...prev, matches, index };
            }
            return prev;
          },
        },
        props: {
          decorations(state: EditorState) {
            const s = searchKey.getState(state);
            if (!s || s.matches.length === 0) return DecorationSet.empty;
            const decos = s.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === s.index ? "search-match search-match-current" : "search-match",
              })
            );
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

function status(editor: Editor): SearchStatus {
  const s = searchKey.getState(editor.state);
  return { count: s?.matches.length ?? 0, index: (s?.index ?? -1) + 1 };
}

/** Scroll the given range into view (centre), without moving the caret. */
function scrollTo(editor: Editor, range: Match): void {
  const at = editor.view.domAtPos(range.from);
  const node =
    at.node.nodeType === Node.TEXT_NODE
      ? at.node.parentElement
      : (at.node as HTMLElement);
  node?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** Set the term, highlight matches, jump to the first, and report count/index. */
export function setSearch(editor: Editor, term: string): SearchStatus {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { term }));
  const s = searchKey.getState(editor.state);
  if (s && s.matches.length) scrollTo(editor, s.matches[0]);
  return status(editor);
}

/** Move to the next (dir=1) or previous (dir=-1) match, wrapping around. */
export function stepSearch(editor: Editor, dir: 1 | -1): SearchStatus {
  const s = searchKey.getState(editor.state);
  if (!s || s.matches.length === 0) return { count: 0, index: 0 };
  const next = (s.index + dir + s.matches.length) % s.matches.length;
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { index: next }));
  scrollTo(editor, s.matches[next]);
  return { count: s.matches.length, index: next + 1 };
}

export function clearSearch(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { term: "" }));
}
