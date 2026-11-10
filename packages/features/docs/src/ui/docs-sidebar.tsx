"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { submitKeys } from "@markbase/ui/keys";
import { VaultTree } from "./vault-tree";
import { VaultSwitcher } from "./vault-switcher";
import { DocSearchResults } from "./doc-search";
import { isSharedScope } from "./scope";
import type { VaultMeta } from "./new-vault-modal";
import type { OpenIntent } from "@markbase/docs/workspace-tabs";

/**
 * Column 2 — the documentation sidebar. The focused vault's folder/doc tree on
 * top, the vault switcher pinned to the bottom. Sits between the primary icon
 * rail and the document workspace.
 *
 * This is the body of the sidebar column, not the column itself: DocsShell
 * renders the column (its width, border and background) and puts DocsHeader
 * above this in it, so the header and the tree share one container and the
 * header is exactly as wide as the tree below it — see DocsHeader for the
 * misalignment that put it there. This fills whatever is left.
 */
/**
 * Memoised. The tree is the biggest thing on the surface — a real vault renders
 * a couple of THOUSAND rows — and none of its props say which document is
 * active, so it has nothing to say about a tab switch. It re-rendered on every
 * one of them anyway, because its parent did.
 */
export const DocsSidebar = memo(function DocsSidebar({
  vaults,
  focusedVaultId,
  treeVersion,
  loadingVaults,
  syncing,
  searching,
  onExitSearch,
  onFocus,
  onOpenDoc,
  onNewVault,
  onRenamed,
  onDeleted,
  onUnmounted,
}: {
  vaults: VaultMeta[];
  focusedVaultId: string | null;
  /** Bumped when the vault's doc set changes (create, or a daemon-synced file) so
   *  the tree re-fetches in place and shows it. */
  treeVersion: number;
  /** Which vault to show isn't known yet — the tree holds its fetch. */
  loadingVaults: boolean;
  /** The focused vault's first sync, while it runs. Null when idle. */
  syncing?: { done: number; total: number } | null;
  /** Show search instead of the file tree — the header's toggle owns this. */
  searching: boolean;
  /** Leave search (Esc, or finding nothing more to look for). */
  onExitSearch: () => void;
  onFocus: (id: string) => void;
  /** Open a document — in the current tab, or a new one (⌘/Ctrl or middle click). */
  onOpenDoc: (docId: string, title: string, intent: OpenIntent) => void;
  onNewVault: () => void;
  onRenamed: (vault: VaultMeta) => void;
  onDeleted: (id: string) => void;
  /** A vault was deliberately unmounted here, so it leaves the app. */
  onUnmounted: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const box = useRef<HTMLInputElement>(null);

  // Turning search on should put the cursor in it — otherwise the button opens a
  // field you then have to click.
  useEffect(() => {
    if (searching) box.current?.focus();
  }, [searching]);

  return (
    <aside className="flex min-h-0 flex-1 flex-col">

      {/* Two states, never both: the files you have, or a search across them.
          The search box belongs to its own state rather than sitting above the
          tree forever, where it was a permanent 40px of chrome for something
          used occasionally. */}
      {searching && (
        <div className="shrink-0 px-2 pt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={box}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={submitKeys({
                // Nothing to submit — results follow the text. Esc is the way out,
                // clearing a query first so one press never does two things.
                onSubmit: () => {},
                onEscape: () => (trimmed ? setQuery("") : onExitSearch()),
              })}
              placeholder="Search documents…"
              className="w-full rounded-md border bg-background py-1.5 pr-7 pl-7 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col pt-2">
        {searching ? (
          trimmed ? (
          <DocSearchResults
            query={trimmed}
            vaultId={focusedVaultId}
            shared={isSharedScope(focusedVaultId)}
            onOpenDoc={(id, title, intent) => onOpenDoc(id, title || "Untitled", intent)}
          />
          ) : (
            // Search with nothing typed shows nothing found — not the tree. The
            // sidebar is in its search state, and quietly showing the file list
            // instead would make the state itself invisible.
            <p className="px-3 text-sm text-muted-foreground">
              Type to search this vault&rsquo;s documents.
            </p>
          )
        ) : (
          <VaultTree
            key={focusedVaultId ?? "none"}
            vaultId={focusedVaultId}
            reloadKey={treeVersion}
            awaitingScope={loadingVaults && !focusedVaultId}
            syncing={syncing}
            variant="sidebar"
            onOpenDoc={(id, title, intent) => onOpenDoc(id, title ?? "Untitled", intent)}
          />
        )}
      </div>

      <VaultSwitcher
        vaults={vaults}
        focusedVaultId={focusedVaultId}
        onFocus={onFocus}
        onNewVault={onNewVault}
        onRenamed={onRenamed}
        onDeleted={onDeleted}
        onUnmounted={onUnmounted}
      />
    </aside>
  );
});
