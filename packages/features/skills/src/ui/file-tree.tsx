"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  File as FileIcon,
  Folder,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { cn } from "@markbase/ui/utils";

// The flat input the tree is built from. SKILL.md is passed as a node with
// id SKILL_MD_ID so it sits at the root like any file.
export const SKILL_MD_ID = "__SKILL_MD__";

export type FileEntry = {
  id: string;
  path: string;
  dirty?: boolean;
};

type TreeFile = { type: "file"; name: string; entry: FileEntry };
type TreeDir = { type: "dir"; name: string; path: string; children: TreeNode[] };
type TreeNode = TreeFile | TreeDir;

function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeDir = { type: "dir", name: "", path: "", children: [] };

  for (const entry of entries) {
    const parts = entry.path.split("/");
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const path = parts.slice(0, i + 1).join("/");
      let next = dir.children.find(
        (c): c is TreeDir => c.type === "dir" && c.name === name
      );
      if (!next) {
        next = { type: "dir", name, path, children: [] };
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ type: "file", name: parts[parts.length - 1], entry });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1; // dirs first
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) if (n.type === "dir") sort(n.children);
  };
  sort(root.children);
  return root.children;
}

function fileIcon(name: string) {
  if (/\.(md|markdown|txt)$/i.test(name)) return FileText;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|json|sh|bash|toml|ya?ml|py|css|html?)$/i.test(name))
    return FileCode;
  return FileIcon;
}

export function FileTree({
  entries,
  selectedId,
  onSelect,
  onDelete,
}: {
  entries: FileEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const tree = buildTree(entries);
  return (
    <div className="py-1 text-sm">
      {tree.map((node) => (
        <TreeRow
          key={node.type === "dir" ? `d:${node.path}` : `f:${node.entry.id}`}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.type === "dir") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={pad}
          className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-muted-foreground hover:bg-muted/60"
        >
          {open ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )}
          {open ? (
            <FolderOpen className="size-4 shrink-0" />
          ) : (
            <Folder className="size-4 shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children.map((child) => (
            <TreeRow
              key={child.type === "dir" ? `d:${child.path}` : `f:${child.entry.id}`}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
      </div>
    );
  }

  // Not a component created here: fileIcon picks one of three imported icons by
  // extension, so the identity is stable for a given name and there is no state
  // to reset. The rule sees a capitalised local and cannot tell the difference.
  const Icon = fileIcon(node.name);
  const selected = node.entry.id === selectedId;
  const isSkillMd = node.entry.id === SKILL_MD_ID;

  return (
    <div
      style={pad}
      className={cn(
        "group flex items-center gap-1.5 py-1 pr-2",
        selected ? "bg-[#e5ff6e]/25 font-medium" : "hover:bg-muted/60"
      )}
    >
      <span className="w-3.5 shrink-0" />
      <button
        type="button"
        onClick={() => onSelect(node.entry.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
        {node.entry.dirty && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-foreground/60"
            title="Unsaved"
          />
        )}
      </button>
      {!isSkillMd && (
        <button
          type="button"
          onClick={() => onDelete(node.entry.id)}
          aria-label={`Delete ${node.name}`}
          title="Delete file"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  );
}
