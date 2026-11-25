"use client";

import { useState } from "react";
import { type Editor, useEditorState } from "@tiptap/react";
import { submitKeys } from "@markbase/ui/keys";
import { useDocStatus } from "./use-doc-status";
import {
  AlertTriangle,
  Calendar,
  Check,
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
  docId,
}: {
  editor: Editor;
  editable: boolean;
  /** The document's id, for its status. Without one, no status is shown. */
  docId?: string;
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

      {docId && <DocStatusBar docId={docId} editor={editor} editable={editable} />}

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

// What Markbase works out about the document (doc types, layer 1): read-only
// badges, never stored in its front matter, and the Confirm button that feeds
// them.
export function DocStatusBar({ docId, editor, editable }: { docId: string; editor: Editor; editable: boolean }) {
  const { available, status, confirm, confirming, error } = useDocStatus(docId, editor);
  if (!available || !status) return null;

  const people = status.current_confirmations.filter((c) => c.by.startsWith("human:"));
  const latest = (people.length ? people : status.current_confirmations).at(-1);
  const trustText =
    status.trust === "human_confirmed"
      ? `Confirmed by ${latest?.name ?? "a person"} · ${shortDate(latest?.at)}`
      : status.trust === "agent_confirmed"
        ? `Confirmed by ${latest?.name ?? "an agent"} (agent) · ${shortDate(latest?.at)}`
        : "Not confirmed since the last change";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <Badge tone={status.trust === "human_confirmed" ? "good" : status.trust === "agent_confirmed" ? "info" : "muted"}>
        {trustText}
      </Badge>
      {status.fields.status === "draft" && <Badge tone="warn">Draft</Badge>}
      {status.fields.status === "deprecated" && (
        <Badge tone="bad">
          Deprecated{status.fields.superseded_by ? ` · see ${status.fields.superseded_by}` : ""}
        </Badge>
      )}
      {status.needs_review && <Badge tone="warn">Review due</Badge>}
      {status.warnings.length > 0 && (
        <span title={status.warnings.map((w) => w.message).join("\n")}>
          <Badge tone="warn">
            <AlertTriangle className="size-3" />
            {status.warnings.length} property {status.warnings.length === 1 ? "warning" : "warnings"}
          </Badge>
        </span>
      )}
      {editable && (
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={confirming}
          title="Confirm the current text is right. The next meaningful edit ends it."
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <Check className="size-3" />
          {confirming ? "Confirming…" : "Confirm"}
        </button>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}

const TONES = {
  good: "bg-green-500/10 text-green-700 dark:text-green-400",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "bg-red-500/10 text-red-700 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
} as const;

function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${TONES[tone]}`}>{children}</span>;
}

function shortDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
