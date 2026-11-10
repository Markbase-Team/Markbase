"use client";

import { useEffect, useState } from "react";
import { api } from "@markbase/protocol/api-client";
import { Copy, GitCompare, Loader2, Trash2, X } from "lucide-react";
import { diffSegments, type DiffSegment } from "@markbase/docs";
import { cn } from "@markbase/ui/utils";
import { useDocsPorts, type LocalFork } from "./ports";
import { DiffBody } from "./version-preview";
import { invalidateDocLists } from "./doc-list-fetch";

// A document shared with this person read-only, whose file in their Shared
// Vault they edited anyway (docs/shared-vault.md). The daemon kept the edits as
// a live fork — merged with what the cloud sends, never sent up — and told the
// host. This is where the host tells the person, on the document itself, and
// offers the ways out: see the difference, drop the edits, or keep them as a
// document of their own. Asking for edit access is a later surface.
//
// Only the desktop has a forks port; in a browser this renders nothing, and so
// does a document that is not forked.

/** The person's vaults, for "keep a copy" to file the copy into. */
interface VaultOption {
  id: string;
  name: string;
}

export function LocalForkBanner({ docId }: { docId: string }) {
  const { forks } = useDocsPorts();
  const [fork, setFork] = useState<LocalFork | null>(null);
  const [diff, setDiff] = useState<DiffSegment[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [vaults, setVaults] = useState<VaultOption[] | null>(null);
  const [keepInto, setKeepInto] = useState<string>("");
  const [busy, setBusy] = useState<"discard" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Which fork is this document's, kept current as the daemon's set moves.
  useEffect(() => {
    if (!forks) return;
    let cancelled = false;
    const pick = (list: LocalFork[]) => {
      if (cancelled) return;
      const mine = list.find((f) => f.docId === docId) ?? null;
      setFork(mine);
      if (!mine) {
        setComparing(false);
        setDiff(null);
      }
    };
    void forks.list().then(pick, () => pick([]));
    const off = forks.onChanged(pick);
    return () => {
      cancelled = true;
      off();
    };
  }, [forks, docId]);

  if (!forks || !fork) return null;

  const compare = async (): Promise<void> => {
    if (comparing) {
      setComparing(false);
      return;
    }
    setComparing(true);
    setDiff(null);
    const both = await forks.compare(docId);
    // Gone between the click and the answer — the banner is about to leave too.
    if (!both) return;
    setDiff(diffSegments(both.cloud, both.local));
  };

  const discard = async (): Promise<void> => {
    if (!confirm(`Discard your edits to "${fork.title}"? The file goes back to what the owner has.`)) return;
    setBusy("discard");
    setError(null);
    const res = await forks.discard(docId);
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Couldn't discard the edits.");
  };

  const loadVaults = async (): Promise<void> => {
    if (vaults !== null) return;
    try {
      const { vaults: list } = await api.json<{ vaults: VaultOption[] }>("/api/v1/vaults");
      setVaults(list);
      if (list[0]) setKeepInto(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVaults([]);
    }
  };

  const keepCopy = async (): Promise<void> => {
    if (!keepInto) return;
    setBusy("keep");
    setError(null);
    const res = await forks.keepCopy(docId, keepInto);
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Couldn't keep a copy.");
      return;
    }
    invalidateDocLists(); // the copy is a new document in one of your vaults
  };

  return (
    <div
      role="status"
      className="mx-auto mt-2 w-full max-w-3xl shrink-0 rounded-lg border border-[#e5ff6e] bg-[#e5ff6e]/15 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">Local-only edits</span>
        <span className="text-muted-foreground">
          This document is shared with you read-only. Your edits to{" "}
          <span className="font-mono text-xs">{fork.path}</span> stay on this Mac and are not
          sent to the owner.
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void compare()}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted",
              comparing && "bg-muted"
            )}
          >
            <GitCompare className="size-3.5" />
            Compare
          </button>
          <button
            type="button"
            onClick={() => void discard()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            {busy === "discard" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Discard my edits
          </button>
          {vaults === null ? (
            <button
              type="button"
              onClick={() => void loadVaults()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              <Copy className="size-3.5" />
              Keep a copy…
            </button>
          ) : (
            <span className="inline-flex items-center gap-1">
              <select
                value={keepInto}
                onChange={(e) => setKeepInto(e.target.value)}
                aria-label="Vault to keep the copy in"
                className="rounded-md border bg-background px-1.5 py-1 text-xs"
              >
                {vaults.length === 0 && <option value="">No vaults</option>}
                {vaults.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void keepCopy()}
                disabled={busy !== null || !keepInto}
                className="inline-flex items-center gap-1 rounded-md bg-[#e5ff6e] px-2 py-1 text-xs font-semibold text-neutral-900 hover:brightness-95 disabled:opacity-50"
              >
                {busy === "keep" ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                Keep a copy
              </button>
              <button
                type="button"
                onClick={() => setVaults(null)}
                aria-label="Cancel keeping a copy"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </span>
          )}
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>}
      {comparing && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          <DiffBody diff={diff} />
        </div>
      )}
    </div>
  );
}
