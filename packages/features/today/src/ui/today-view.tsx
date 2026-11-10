"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckSquare,
  FileText,
  GripVertical,
  Loader2,
  Plus,
  Square,
  X,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { cn } from "@markbase/ui/utils";
import { AppHeader } from "@markbase/ui/app-header";
import { MarkdownEditor } from "@markbase/ui/markdown-editor";

type Todo = {
  id: string;
  day: string;
  text: string;
  done: boolean;
  details: string;
  position: number;
  created_at: string;
};

// The viewer's local calendar date as YYYY-MM-DD. Todos are scoped to this day,
// so "Today!" shows a fresh list each day (in the viewer's timezone).
function localDay() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Legacy shape: todos used to live in localStorage under `today-todos:<day>`.
const LEGACY_PREFIX = "today-todos:";
type LegacyTodo = { text?: string; done?: boolean; details?: string };

// One-time import: move any browser-local todos into the database, preserving
// their day/done/details, then clear the keys. Removes each item from storage
// only after it's persisted, so an interrupted run won't create duplicates.
// Safe to keep around — it's a no-op once localStorage is empty.
async function migrateLegacyTodos() {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LEGACY_PREFIX)) keys.push(k);
    }
  } catch {
    return; // storage unavailable — nothing to import
  }

  let imported = 0;
  for (const key of keys) {
    const keyDay = key.slice(LEGACY_PREFIX.length);
    let items: LegacyTodo[];
    try {
      const parsed: LegacyTodo[] = JSON.parse(localStorage.getItem(key) ?? "[]");
      items = Array.isArray(parsed) ? parsed : [];
    } catch {
      localStorage.removeItem(key); // corrupt — drop it
      continue;
    }

    const remaining = [...items];
    while (remaining.length) {
      const it = remaining[0];
      const text = typeof it?.text === "string" ? it.text.trim() : "";
      if (!text) {
        remaining.shift();
        continue;
      }
      try {
        const res = await fetch("/api/v1/todos", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, day: keyDay }),
        });
        const data: { todo?: { id: string } } = await res.json();
        if (!res.ok || !data.todo) throw new Error();
        const details = typeof it.details === "string" ? it.details.trim() : "";
        if (it.done || details) {
          await fetch(`/api/v1/todos/${data.todo.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ done: !!it.done, details }),
          });
        }
        imported += 1;
        remaining.shift();
        // Persist progress so a later failure doesn't re-import these.
        if (remaining.length) {
          localStorage.setItem(key, JSON.stringify(remaining));
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        // Network/server hiccup — keep what's left for the next page load.
        localStorage.setItem(key, JSON.stringify(remaining));
        return;
      }
    }
  }

  if (imported > 0) {
    toast.success(`Imported ${imported} todo${imported === 1 ? "" : "s"} from this browser`);
  }
}

export function TodayView() {
  const day = useMemo(() => localDay(), []);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  // The todo whose details are open in the editor modal, plus a working draft
  // of its markdown (committed back on save/close).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState("");
  const editing = todos.find((t) => t.id === editingId) ?? null;

  // Load this day's list from the database on mount, importing any legacy
  // browser-local todos first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateLegacyTodos();
      if (cancelled) return;
      try {
        const res = await fetch(`/api/v1/todos?day=${day}`);
        const data: { todos?: Todo[]; error?: string } = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        if (!cancelled) setTodos(data.todos ?? []);
      } catch {
        if (!cancelled) toast.error("Couldn't load today's todos");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [day]);

  async function add() {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/v1/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, day }),
      });
      const data: { todo?: Todo; error?: string } = await res.json();
      if (!res.ok || !data.todo) throw new Error(data.error ?? "Failed to add");
      setTodos((t) => [...t, data.todo!]);
      setDraft("");
    } catch {
      toast.error("Couldn't add that todo");
    } finally {
      setAdding(false);
    }
  }

  // Optimistically patch a todo locally, then persist; revert on failure.
  async function patch(id: string, changes: Partial<Todo>, errMsg: string) {
    const prev = todos;
    setTodos((t) =>
      t.map((todo) => (todo.id === id ? { ...todo, ...changes } : todo))
    );
    try {
      const res = await fetch(`/api/v1/todos/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTodos(prev);
      toast.error(errMsg);
    }
  }

  function toggle(todo: Todo) {
    patch(todo.id, { done: !todo.done }, "Couldn't update that todo");
  }

  async function remove(id: string) {
    const prev = todos;
    setTodos((t) => t.filter((todo) => todo.id !== id));
    try {
      const res = await fetch(`/api/v1/todos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setTodos(prev);
      toast.error("Couldn't delete that todo");
    }
  }

  // Reorder after a drag: move the row locally, then persist the new order.
  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const prev = todos;
    const from = prev.findIndex((t) => t.id === active.id);
    const to = prev.findIndex((t) => t.id === over.id);
    if (from === -1 || to === -1) return;

    const next = arrayMove(prev, from, to);
    setTodos(next);
    try {
      const res = await fetch("/api/v1/todos/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ day, orderedIds: next.map((t) => t.id) }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTodos(prev);
      toast.error("Couldn't reorder todos");
    }
  }

  function openDetails(todo: Todo) {
    setEditingId(todo.id);
    setDetailsDraft(todo.details ?? "");
  }

  // Commit the details draft back onto its todo and close the modal.
  function saveDetails() {
    if (!editingId) return;
    const id = editingId;
    const next = detailsDraft.trim();
    setEditingId(null);
    if (next !== (todos.find((t) => t.id === id)?.details ?? "")) {
      patch(id, { details: next }, "Couldn't save details");
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const dateLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    []
  );
  const remaining = todos.filter((t) => !t.done).length;

  return (
    <div className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="Today!" />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="px-4 py-6 sm:px-6">
      <div className="max-w-3xl">
        <p className="text-sm text-muted-foreground sm:text-base">
          {dateLabel}
          {todos.length > 0 && ` · ${remaining} left`}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="mt-6 flex gap-2"
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What needs doing today?"
            aria-label="New todo"
          />
          <Button type="submit" disabled={!draft.trim() || adding}>
            {adding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
        </form>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={todos.map((t) => t.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mt-6 space-y-1">
              {todos.map((todo) => (
                <SortableTodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={() => toggle(todo)}
                  onOpenDetails={() => openDetails(todo)}
                  onRemove={() => remove(todo.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {loaded && todos.length === 0 && (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            Nothing yet. Add your first task for today.
          </p>
        )}
      </div>

      {/* Per-todo details: a markdown editor in a modal. */}
      <Dialog
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) saveDetails();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">{editing?.text}</DialogTitle>
            <DialogDescription>
              Add notes and details for this task.
            </DialogDescription>
          </DialogHeader>
          <MarkdownEditor
            value={detailsDraft}
            onChange={setDetailsDraft}
            placeholder="Add details…"
          />
          <DialogFooter>
            <Button onClick={saveDetails}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </main>
      </div>
    </div>
  );
}

// One sortable row. Only the grip handle carries the drag listeners, so the
// checkbox, text, and delete button stay clickable.
function SortableTodoRow({
  todo,
  onToggle,
  onOpenDetails,
  onRemove,
}: {
  todo: Todo;
  onToggle: () => void;
  onOpenDetails: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-2 py-2 hover:bg-muted/60",
        isDragging && "opacity-40"
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        className="cursor-grab touch-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing focus-visible:opacity-100"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label={todo.done ? "Mark as not done" : "Mark as done"}
        aria-pressed={todo.done}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        {todo.done ? (
          <CheckSquare className="size-5 text-foreground" />
        ) : (
          <Square className="size-5" />
        )}
      </button>
      <button
        type="button"
        onClick={onOpenDetails}
        title="Edit details"
        className={cn(
          "flex flex-1 items-center gap-1.5 pl-1.5 text-left text-sm",
          todo.done && "text-muted-foreground line-through"
        )}
      >
        <span className="truncate">{todo.text}</span>
        {todo.details?.trim() && (
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Delete todo"
        className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}
