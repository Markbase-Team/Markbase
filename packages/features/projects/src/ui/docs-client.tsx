"use client";

import { useState } from "react";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { Textarea } from "@markbase/ui/textarea";
import { Markdown } from "@markbase/ui/markdown";
import { useProject, type ProjectDoc } from "./project-context";
import { ListEditorLayout, SaveIndicator } from "@markbase/ui/list-editor-layout";

// Per-project documentation: a nested list of docs + a full-height main pane.
// Docs render with the Markdown component (the nicer reading style) and edit as
// raw markdown in a textarea (Edit/Preview toggle) — not the Crepe WYSIWYG.
export function DocsClient() {
  const { docs, docAdding, addDoc, setDocField, removeDoc } = useProject();

  return (
    <ListEditorLayout
      items={docs}
      adding={docAdding}
      onAdd={addDoc}
      addLabel="New doc"
      titleFor={(d) => d.title}
      emptyTitle="Untitled doc"
      emptyDetail={
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Select a doc, or create one.
        </div>
      }
      renderDetail={(doc) => (
        <DocDetail
          doc={doc}
          onField={(patch) => setDocField(doc.id, patch)}
          onRemove={() => removeDoc(doc.id)}
        />
      )}
    />
  );
}

function DocDetail({
  doc,
  onField,
  onRemove,
}: {
  doc: ProjectDoc;
  onField: (patch: Partial<Pick<ProjectDoc, "title" | "content">>) => void;
  onRemove: () => void;
}) {
  // New (empty) docs open in edit mode; existing docs render by default.
  const [editing, setEditing] = useState(() => !doc.content);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <input
          value={doc.title}
          onChange={(e) => onField({ title: e.target.value })}
          placeholder="Untitled doc"
          aria-label="Doc title"
          className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
        />
        <SaveIndicator status={doc.status} />
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-label={editing ? "Preview" : "Edit"}
          title={editing ? "Preview" : "Edit"}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {editing ? <Eye className="size-4" /> : <Pencil className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Delete doc"
          title="Delete doc"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {editing ? (
          <Textarea
            value={doc.content}
            onChange={(e) => onField({ content: e.target.value })}
            placeholder="Write markdown…"
            className="h-full min-h-[16rem] w-full resize-none border-0 bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0"
          />
        ) : doc.content.trim() ? (
          <Markdown content={doc.content} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Empty — click the edit icon to write.
          </p>
        )}
      </div>
    </>
  );
}
