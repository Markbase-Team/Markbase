import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type Node as PMNode } from "@tiptap/pm/model";

// Highlights the text ranges that have comments, plus a transient "active" range
// that flashes when a comment is clicked (so the reader sees where it points).
// Ranges are set via a meta on a transaction (resolved from each comment's quoted
// text, so they survive edits); between updates they map through doc changes.
export const commentHighlightKey = new PluginKey<HighlightState>(
  "commentHighlights"
);

export type CommentRange = { from: number; to: number };

type HighlightState = {
  deco: DecorationSet;
  ranges: CommentRange[];
  active: CommentRange | null;
};

// Pass `ranges` to replace the persistent comment highlights, and/or `active`
// to set (or `null` to clear) the flashed range. Either may be omitted.
type HighlightMeta = { ranges?: CommentRange[]; active?: CommentRange | null };

function inBounds(r: CommentRange, size: number): boolean {
  return r.from < r.to && r.to <= size;
}

function build(
  doc: PMNode,
  ranges: CommentRange[],
  active: CommentRange | null
): DecorationSet {
  const decos: Decoration[] = [];
  for (const r of ranges) {
    if (inBounds(r, doc.content.size)) {
      decos.push(
        Decoration.inline(r.from, r.to, { class: "comment-highlight" })
      );
    }
  }
  if (active && inBounds(active, doc.content.size)) {
    decos.push(
      Decoration.inline(active.from, active.to, {
        class: "comment-highlight comment-highlight-active",
      })
    );
  }
  return DecorationSet.create(doc, decos);
}

export const CommentHighlight = Extension.create({
  name: "commentHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: commentHighlightKey,
        state: {
          init: () => ({
            deco: DecorationSet.empty,
            ranges: [],
            active: null,
          }),
          apply(tr, old): HighlightState {
            const meta = tr.getMeta(commentHighlightKey) as
              | HighlightMeta
              | undefined;
            if (meta) {
              const ranges = meta.ranges ?? old.ranges;
              const active =
                "active" in meta ? meta.active ?? null : old.active;
              return { deco: build(tr.doc, ranges, active), ranges, active };
            }
            if (!tr.docChanged) return old;
            // Map stored ranges (and the decorations) through the change so a
            // later active-only meta still rebuilds against current positions.
            const ranges = old.ranges.map((r) => ({
              from: tr.mapping.map(r.from),
              to: tr.mapping.map(r.to),
            }));
            const active = old.active
              ? {
                  from: tr.mapping.map(old.active.from),
                  to: tr.mapping.map(old.active.to),
                }
              : null;
            return { deco: old.deco.map(tr.mapping, tr.doc), ranges, active };
          },
        },
        props: {
          decorations(state) {
            return commentHighlightKey.getState(state)?.deco;
          },
        },
      }),
    ];
  },
});
