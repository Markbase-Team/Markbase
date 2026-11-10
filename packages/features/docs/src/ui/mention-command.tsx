"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";

// @tiptap/suggestion defaults every instance to the plugin key "suggestion", so
// a second one (SlashCommand's) throws "Adding different instances of a keyed
// plugin". Each suggestion must own a distinct key.
const mentionPluginKey = new PluginKey("mentionSuggestion");
import { Bot } from "lucide-react";
import { cn } from "@markbase/ui/utils";
import type { AgentSessionLite } from "@markbase/ui/use-agent-sessions";
import { isComposingKey } from "@markbase/ui/keys";

export type MentionItem = { id: string; label: string; status: string };

type MenuProps = {
  items: MentionItem[];
  onSelect: (item: MentionItem) => void;
};
type MenuHandle = {
  onKeyDown: (p: { event: KeyboardEvent }) => boolean;
};

const MentionMenu = forwardRef<MenuHandle, MenuProps>(function MentionMenu(
  { items, onSelect },
  ref
) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if ((event.key === "Enter" && !isComposingKey(event)) || event.key === "Tab") {
        onSelect(items[index]);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-64 rounded-lg border bg-popover p-3 text-xs text-muted-foreground shadow-md">
        No agent sessions. Create one on the Agents page.
      </div>
    );
  }

  return (
    <div className="max-h-72 w-64 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(item)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
            i === index ? "bg-muted" : "hover:bg-muted"
          )}
        >
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground capitalize">
            {item.status}
          </span>
        </button>
      ))}
    </div>
  );
});

// Type "@" in a document to mention one of your named agent sessions. Inserts a
// `mention` atom (shared schema) so it round-trips through markdown and collab.
// `getSessions` is a getter, not a snapshot: the editor is created once, but the
// roster loads async and can change.
export const MentionCommand = Extension.create<{
  getSessions: () => AgentSessionLite[];
}>({
  name: "mentionCommand",
  addOptions() {
    return { getSessions: () => [] };
  },
  addProseMirrorPlugins() {
    const getSessions = this.options.getSessions;
    return [
      Suggestion<MentionItem>({
        editor: this.editor,
        pluginKey: mentionPluginKey,
        char: "@",
        // Don't fire mid-word (e-mail addresses, handles already typed).
        allowedPrefixes: [" ", "\n", "(", "["],
        items: ({ query }) =>
          getSessions()
            .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map((s) => ({ id: s.id, label: s.name, status: s.status })),
        command: ({ editor, range, props }: {
          editor: Editor;
          range: Range;
          props: MentionItem;
        }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "mention", attrs: { id: props.id, label: props.label } },
              { type: "text", text: " " },
            ])
            .run();
        },
        render: () => {
          let component: ReactRenderer<MenuHandle, MenuProps> | null = null;
          let el: HTMLDivElement | null = null;
          const place = (rect: DOMRect | null | undefined) => {
            if (!el || !rect) return;
            const menuH = el.offsetHeight || 200;
            const menuW = el.offsetWidth || 256;
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
              component = new ReactRenderer(MentionMenu, {
                editor: props.editor,
                props: {
                  items: props.items,
                  onSelect: (item: MentionItem) => props.command(item),
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
                onSelect: (item: MentionItem) => props.command(item),
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
