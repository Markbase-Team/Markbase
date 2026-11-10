"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";

// Suggestion instances default to the same plugin key; each needs its own or
// ProseMirror throws "Adding different instances of a keyed plugin".
const slashPluginKey = new PluginKey("slashSuggestion");
import {
  CalendarDays,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListChecks,
  ListOrdered,
  type LucideIcon,
  Minus,
  Quote,
  Table as TableIcon,
  Type,
} from "lucide-react";
import { cn } from "@markbase/ui/utils";
import { isComposingKey } from "@markbase/ui/keys";

function todayLong(): string {
  return new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

type SlashItem = {
  title: string;
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
};

const ITEMS: SlashItem[] = [
  { title: "Normal text", icon: Type, run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { title: "Heading 1", icon: Heading1, run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 1 }).run() },
  { title: "Heading 2", icon: Heading2, run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 2 }).run() },
  { title: "Heading 3", icon: Heading3, run: (e, r) => e.chain().focus().deleteRange(r).setNode("heading", { level: 3 }).run() },
  { title: "Bullet list", icon: List, run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: "Numbered list", icon: ListOrdered, run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: "Task list", icon: ListChecks, run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { title: "Quote", icon: Quote, run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: "Code block", icon: Code, run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: "Table", icon: TableIcon, run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Divider", icon: Minus, run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: "Date", icon: CalendarDays, run: (e, r) => e.chain().focus().deleteRange(r).insertContent(`${todayLong()} `).run() },
];

type MenuProps = {
  items: SlashItem[];
  onSelect: (item: SlashItem) => void;
};

type MenuHandle = { onKeyDown: (props: { event: KeyboardEvent }) => boolean };

const SlashMenu = forwardRef<MenuHandle, MenuProps>(function SlashMenu(
  { items, onSelect },
  ref
) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter" && !isComposingKey(event)) {
        if (items[index]) onSelect(items[index]);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;
  return (
    <div className="w-56 overflow-hidden rounded-md border bg-popover p-1 text-sm shadow-md">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(item)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
            i === index ? "bg-muted" : "hover:bg-muted"
          )}
        >
          <item.icon className="size-4 text-muted-foreground" />
          {item.title}
        </button>
      ))}
    </div>
  );
});

// Slash command: type "/" to insert a block. Built on @tiptap/suggestion + a
// positioned React popup (the OpenKnowledge pattern).
export const SlashCommand = Extension.create({
  name: "slashCommand",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        pluginKey: slashPluginKey,
        char: "/",
        startOfLine: false,
        items: ({ query }) =>
          ITEMS.filter((i) =>
            i.title.toLowerCase().includes(query.toLowerCase())
          ).slice(0, 12),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let component: ReactRenderer<MenuHandle, MenuProps> | null = null;
          let el: HTMLDivElement | null = null;
          const place = (rect: DOMRect | null | undefined) => {
            if (!el || !rect) return;
            const menuH = el.offsetHeight || 320;
            const menuW = el.offsetWidth || 224;
            // Flip above the cursor when there isn't room below (and there is above).
            const roomBelow = window.innerHeight - rect.bottom;
            const top =
              roomBelow < menuH + 8 && rect.top > menuH + 8
                ? rect.top - menuH - 4
                : rect.bottom + 4;
            const left = Math.max(
              8,
              Math.min(rect.left, window.innerWidth - menuW - 8)
            );
            el.style.top = `${top}px`;
            el.style.left = `${left}px`;
          };
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                editor: props.editor,
                props: {
                  items: props.items,
                  onSelect: (item: SlashItem) => props.command(item),
                },
              });
              el = document.createElement("div");
              el.style.position = "fixed";
              el.style.zIndex = "50";
              el.appendChild(component.element);
              document.body.appendChild(el);
              place(props.clientRect?.());
            },
            onUpdate: (props) => {
              component?.updateProps({
                items: props.items,
                onSelect: (item: SlashItem) => props.command(item),
              });
              place(props.clientRect?.());
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") return true;
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              el?.remove();
              component?.destroy();
              el = null;
              component = null;
            },
          };
        },
      }),
    ];
  },
});
