"use client";

import { Bot } from "lucide-react";
import { versionCreditText } from "@markbase/docs";
import { cn } from "@markbase/ui/utils";
import { useDocVersions } from "./use-doc-versions";

// The CRDT is the source of history (roadmap B3). Versions live in the document's
// own Y.Doc — one entry per settled edit — and travel with it.

/** History as recorded by the CRDT: one entry per settled edit. */
function CrdtHistory({
  docId,
  selectedIndex,
  onSelectVersion,
}: {
  docId: string;
  selectedIndex: number | null;
  onSelectVersion: (index: number | null) => void;
}) {
  const { versions, loading } = useDocVersions(docId, true);

  if (loading) return <p className="text-muted-foreground text-xs">Loading history…</p>;
  if (versions.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No versions yet. One is recorded when your editing settles.
      </p>
    );
  }
  // Clicking reports OUTWARD: the version opens in the main area, in place of the
  // editor. The diff belongs where the document is, not squeezed into a sidebar.
  return (
    <ol className="space-y-1" data-testid="crdt-history">
      {versions
        .slice()
        .reverse()
        .map((v) => {
          const selected = selectedIndex === v.index;
          return (
            <li key={v.index}>
              <button
                type="button"
                data-testid={"version-" + v.index}
                onClick={() => onSelectVersion(selected ? null : v.index)}
                className={cn(
                  "flex w-full flex-col rounded px-1.5 py-1 text-left hover:bg-muted",
                  selected && "bg-muted ring-1 ring-border"
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  <span className="truncate">{v.label ?? "Version " + (v.index + 1)}</span>
                  {(v.added > 0 || v.removed > 0) && (
                    <span className="shrink-0 font-normal tabular-nums">
                      {v.added > 0 && (
                        <span className="text-emerald-600 dark:text-emerald-400">+{v.added}</span>
                      )}
                      {v.added > 0 && v.removed > 0 && " "}
                      {v.removed > 0 && (
                        <span className="text-red-600 dark:text-red-400">−{v.removed}</span>
                      )}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  {/* An agent wrote some or all of it: its hook said so (the vault's agent audit). */}
                  {v.agents && v.agents.length > 0 && (
                    <Bot className="size-3 shrink-0" aria-label="Written by an agent" />
                  )}
                  <span className="truncate">
                    {versionCreditText(v) ?? "You"}
                    {" · "}
                    {new Date(v.at).toLocaleString()}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
    </ol>
  );
}

// The document's version history (from its CRDT). Clicking a version selects it —
// the workspace shows that version in the main area, in place of the editor.
export function DocHistory({
  docId,
  selectedVersion,
  onSelectVersion,
}: {
  docId: string;
  /** The version INDEX shown in the main area, or null while editing. */
  selectedVersion?: number | null;
  onSelectVersion?: (index: number | null) => void;
}) {
  return (
    <div className="space-y-2 text-xs">
      <h3 className="text-sm font-semibold">History</h3>
      <CrdtHistory
        docId={docId}
        selectedIndex={selectedVersion ?? null}
        onSelectVersion={onSelectVersion ?? (() => {})}
      />
    </div>
  );
}
