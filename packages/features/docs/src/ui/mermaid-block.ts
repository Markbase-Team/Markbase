import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView, ViewMutationRecord } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Draw ```mermaid blocks as diagrams, and show their source when you are in them.
 *
 * The block already parsed correctly — `codeBlock { language: "mermaid" }`, round
 * tripping exactly — so nothing was broken about the content. There was simply
 * nowhere that drew it, and a page of `flowchart TD` source is not what anyone
 * writing a diagram is looking at it for.
 *
 * In this editor a mermaid block is ALWAYS the picture. The source belongs to the
 * markdown view, which is a separate editor reached by the Code button — so
 * revealing it here on a click was showing you the thing you switch modes to
 * avoid, in the one mode that exists to hide it.
 *
 * Clicking selects the block rather than putting the caret inside it. The text is
 * still in the document (ProseMirror needs a contentDOM for a text block, and
 * removing it would make this a different node type), but nothing here ever puts
 * a cursor in something invisible.
 *
 * mermaid itself is ~500KB and loads on first use, not with the editor. A
 * document with no diagrams never pays for it.
 */

const mermaidKey = new PluginKey("mermaidSource");

/** Loaded once, on the first diagram anyone looks at. */
let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid(): Promise<typeof import("mermaid").default> {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        // The editor is themed by the page; "neutral" reads correctly on either
        // background without us restating a palette mermaid already has.
        theme: "neutral",
        securityLevel: "strict",
        fontFamily: "inherit",
      });
      return m.default;
    });
  }
  return mermaidLoader;
}

let diagramSeq = 0;

/** Is this node a mermaid block? */
function isMermaid(node: PMNode): boolean {
  return node.type.name === "codeBlock" && node.attrs.language === "mermaid";
}

class MermaidView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly pre: HTMLPreElement;
  private node: PMNode;
  private rendered = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined
  ) {
    this.node = node;

    this.dom = document.createElement("div");
    this.dom.className = "mermaid-block";

    this.preview = document.createElement("div");
    this.preview.className = "mermaid-preview";
    // Select the block, do not enter it. Entering would put the caret in text
    // this mode never shows; selecting gives the usual outline, so it can be
    // moved, copied or deleted like any other block.
    this.preview.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      this.view.dispatch(
        this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos))
      );
      this.view.focus();
    });

    this.pre = document.createElement("pre");
    const code = document.createElement("code");
    this.pre.appendChild(code);
    this.contentDOM = code;

    this.dom.appendChild(this.preview);
    this.dom.appendChild(this.pre);
    this.sync();
  }

  /** Re-render if the text changed; never on every keystroke. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.draw(), 300);
  }

  private async draw(): Promise<void> {
    const source = this.node.textContent.trim();
    if (!source || source === this.rendered) return;
    this.rendered = source;
    try {
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render(`mermaid-${++diagramSeq}`, source);
      this.preview.innerHTML = svg;
      this.preview.classList.remove("mermaid-error");
    } catch (e) {
      // Say what is wrong. A diagram that silently fails to appear is
      // indistinguishable from one that is still loading, or from no support at
      // all — which is exactly the state this extension exists to end.
      this.rendered = ""; // so a fixed source re-renders
      this.preview.classList.add("mermaid-error");
      this.preview.textContent =
        e instanceof Error ? e.message : "This diagram could not be drawn.";
    }
  }

  private sync(): void {
    this.dom.classList.toggle("mermaid-live", isMermaid(this.node));
    if (isMermaid(this.node)) this.schedule();
  }

  update(node: PMNode): boolean {
    // A code block that stopped (or started) being mermaid is a different thing
    // to show; let ProseMirror build a fresh view for it.
    if (node.type !== this.node.type) return false;
    if (isMermaid(node) !== isMermaid(this.node)) return false;
    this.node = node;
    this.sync();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // Our own SVG. Without this, ProseMirror treats mermaid's DOM writes as
    // edits to the document.
    return this.preview.contains(mutation.target);
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

export const MermaidBlock = Extension.create({
  name: "mermaidBlock",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mermaidKey,
        props: {
          nodeViews: {
            codeBlock: (node, view, getPos) =>
              new MermaidView(node, view, getPos as () => number | undefined),
          },
        },
      }),
    ];
  },
});
