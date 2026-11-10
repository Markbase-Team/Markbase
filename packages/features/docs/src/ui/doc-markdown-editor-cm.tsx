"use client";

import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";

// Blends CodeMirror into the document column: transparent, no gutters, and — the
// key bit — `.cm-scroller { overflow: visible }` plus `height: auto` so the editor
// GROWS with its content instead of scrolling inside its own box. The document's
// outer scroll container handles scrolling, so there's no nested scrollbar.
const docTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", height: "auto" },
  "&.cm-editor.cm-focused": { outline: "none" },
  ".cm-scroller": {
    overflow: "visible",
    fontFamily:
      "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
    fontSize: "13.5px",
    lineHeight: "1.7",
  },
  ".cm-content": { padding: 0, caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 2px" },
  ".cm-gutters": { display: "none" },
});

// CodeMirror 6 markdown source editor for the doc's "Markdown" mode — syntax
// highlighting + soft-wrap, grows with content. Browser-only (loaded via the
// dynamic wrapper in doc-markdown-editor.tsx). Its value/onChange are wired to the
// doc's CRDT markdown by MarkdownTabEditor.
export default function DocMarkdownEditorCM({
  value,
  onChange,
  editable,
}: {
  value: string;
  onChange: (next: string) => void;
  editable: boolean;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      editable={editable}
      readOnly={!editable}
      theme={docTheme}
      extensions={[markdown(), EditorView.lineWrapping]}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
        searchKeymap: false,
      }}
    />
  );
}
