import { Extension } from "@tiptap/core";
import { intentFromClick, type OpenIntent } from "@markbase/docs/workspace-tabs";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Wiki-style cross-references: `[[note-name]]` inside a doc (Obsidian syntax).
//
// They stay PLAIN TEXT in the model — so markdown and the CRDT round-trip
// untouched, and an agent writing `[[foo]]` just works. This plugin only
// DECORATES each `[[…]]` as a link and, on click, hands the target name to the
// app (`onNavigate`) to resolve against the vault and open. A plain click follows
// it in the tab you're in; ⌘/Ctrl-click opens a new tab — tabs are workspaces
// (see @markbase/docs/workspace-tabs). To edit a link's text, put the caret in
// it with the keyboard or click just beside it.
//
// `[[name|alias]]` and `[[name#heading]]` are accepted — the target is the part
// before the first `|` or `#`.

export interface WikiLinkOptions {
  onNavigate: (target: string, intent: OpenIntent) => void;
}

type Hit = { from: number; to: number; target: string };

const wikiKey = new PluginKey<Hit[]>("wikiLink");
const WIKI_RE = /\[\[([^[\]\n]+?)\]\]/g;

function findWikiLinks(doc: PMNode): Hit[] {
  const out: Hit[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true;
    const text = node.text;
    WIKI_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_RE.exec(text)) !== null) {
      const target = m[1].split("|")[0].split("#")[0].trim();
      if (target) out.push({ from: pos + m.index, to: pos + m.index + m[0].length, target });
    }
    return true;
  });
  return out;
}

export const WikiLink = Extension.create<WikiLinkOptions>({
  name: "wikiLink",

  addOptions() {
    return { onNavigate: () => {} };
  },

  addProseMirrorPlugins() {
    // Read the latest callback each click (DocEditor points it at a ref).
    const getNavigate = () => this.options.onNavigate;
    return [
      new Plugin<Hit[]>({
        key: wikiKey,
        state: {
          init: (_config, state) => findWikiLinks(state.doc),
          apply: (tr, prev) => (tr.docChanged ? findWikiLinks(tr.doc) : prev),
        },
        props: {
          decorations(state: EditorState) {
            const hits = wikiKey.getState(state);
            if (!hits || hits.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              hits.map((h) =>
                Decoration.inline(h.from, h.to, {
                  class: "wikilink",
                  title: "Click to open · ⌘/Ctrl+click for a new tab",
                })
              )
            );
          },
          handleClick(view, pos, event) {
            const hit = wikiKey.getState(view.state)?.find((h) => pos >= h.from && pos < h.to);
            if (!hit) return false;
            event.preventDefault();
            getNavigate()(hit.target, intentFromClick(event));
            return true;
          },
        },
      }),
    ];
  },
});
