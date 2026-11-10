"use client";

import { useMemo } from "react";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { python } from "@codemirror/legacy-modes/mode/python";

function langExtensions(path: string): Extension[] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return [javascript({ jsx: true, typescript: true })];
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return [javascript({ jsx: true })];
    case "json":
      return [json()];
    case "html":
    case "htm":
      return [html()];
    case "css":
      return [css()];
    case "md":
    case "markdown":
      return [markdown()];
    case "sh":
    case "bash":
    case "zsh":
      return [StreamLanguage.define(shell)];
    case "toml":
      return [StreamLanguage.define(toml)];
    case "yml":
    case "yaml":
      return [StreamLanguage.define(yaml)];
    case "py":
      return [StreamLanguage.define(python)];
    default:
      return [];
  }
}

// CodeMirror 6 source editor (syntax highlighting per file extension). Used for
// every non-markdown file in the skill explorer. Browser-only — loaded via the
// dynamic wrapper in code-editor.tsx.
export default function CodeEditorCM({
  value,
  onChange,
  path,
}: {
  value: string;
  onChange: (next: string) => void;
  path: string;
}) {
  const extensions = useMemo(() => langExtensions(path), [path]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      height="100%"
      style={{ height: "100%", fontSize: "13px" }}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        highlightActiveLineGutter: true,
        foldGutter: true,
        autocompletion: false,
        tabSize: 2,
      }}
    />
  );
}
