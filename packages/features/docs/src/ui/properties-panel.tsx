"use client";

import { useState } from "react";
import { type Editor, useEditorState } from "@tiptap/react";
import { submitKeys } from "@markbase/ui/keys";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  List,
  Plus,
  Type,
  X,
} from "lucide-react";

// Editor chrome for document frontmatter (the "Properties" panel). Reads/writes
// the single `frontmatter` node at the top of the doc (its `data` attr). Always
// shown for editors (with "+ Add"); hidden when empty for read-only viewers.

type FMValue = string | string[];
type FM = Record<string, FMValue>;

function readFrontmatter(editor: Editor): FM {
  const first = editor.state.doc.firstChild;
  if (first?.type.name === "frontmatter") {
    return { ...((first.attrs.data as FM) ?? {}) };
  }
  return {};
}

function writeFrontmatter(editor: Editor, data: FM) {
  editor.commands.command(({ tr, state }) => {
    const first = state.doc.firstChild;
    const empty = Object.keys(data).length === 0;
    const type = state.schema.nodes.frontmatter;
    if (first?.type.name === "frontmatter") {
      if (empty) tr.delete(0, first.nodeSize);
      else tr.setNodeMarkup(0, undefined, { data });
    } else if (!empty) {
      tr.insert(0, type.create({ data }));
    }
    return true;
  });
}

function fieldType(value: FMValue): "tags" | "date" | "text" {
  if (Array.isArray(value)) return "tags";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  return "text";
}

export function PropertiesPanel({
  editor,
  editable,
}: {
  editor: Editor;
  editable: boolean;
}) {
  const dataJson = useEditorState({
    editor,
    selector: ({ editor: ed }) => JSON.stringify(readFrontmatter(ed)),
  });
  const data: FM = JSON.parse(dataJson ?? "{}");
  const keys = Object.keys(data);

  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");

  function set(key: string, value: FMValue) {
    writeFrontmatter(editor, { ...data, [key]: value });
  }
  function remove(key: string) {
    const next = { ...data };
    delete next[key];
    writeFrontmatter(editor, next);
  }
  function addKey() {
    const k = newKey.trim();
    if (k && !(k in data)) writeFrontmatter(editor, { ...data, [k]: "" });
    setNewKey("");
    setAdding(false);
  }

  if (keys.length === 0 && !editable) return null;

  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-sm font-semibold hover:text-foreground"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Properties
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 text-sm">
          {keys.map((key) => {
            const type = fieldType(data[key]);
            const Icon = type === "tags" ? List : type === "date" ? Calendar : Type;
            return (
              <div key={key} className="group flex items-start gap-3">
                <Icon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                <span className="mt-0.5 w-32 shrink-0 truncate text-muted-foreground">
                  {key}
                </span>
                <div className="min-w-0 flex-1">
                  {type === "tags" ? (
                    <TagsField
                      values={data[key] as string[]}
                      editable={editable}
                      onChange={(v) => set(key, v)}
                    />
                  ) : type === "date" ? (
                    <input
                      type="date"
                      disabled={!editable}
                      defaultValue={data[key] as string}
                      onChange={(e) => set(key, e.target.value)}
                      className="bg-transparent outline-none"
                    />
                  ) : (
                    <input
                      disabled={!editable}
                      defaultValue={data[key] as string}
                      onBlur={(e) => {
                        if (e.target.value !== data[key]) set(key, e.target.value);
                      }}
                      placeholder="Empty"
                      className="w-full bg-transparent outline-none placeholder:text-muted-foreground"
                    />
                  )}
                </div>
                {editable && (
                  <button
                    type="button"
                    onClick={() => remove(key)}
                    className="text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                    aria-label={`Remove ${key}`}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}

          {editable &&
            (adding ? (
              <input
                autoFocus
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={submitKeys({ onSubmit: addKey, onEscape: () => setAdding(false) })}
                onBlur={addKey}
                placeholder="Property name"
                className="ml-6 bg-transparent text-muted-foreground outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="ml-6 flex items-center gap-1 text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3.5" />
                Add
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function TagsField({
  values,
  editable,
  onChange,
}: {
  values: string[];
  editable: boolean;
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-blue-600 dark:text-blue-400"
        >
          #{tag}
          {editable && (
            <button
              type="button"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={submitKeys({
            onSubmit: () => {
              if (!input.trim()) return;
              onChange([...values, input.trim()]);
              setInput("");
            },
          })}
          placeholder="Add tag"
          className="w-20 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      )}
    </div>
  );
}
