"use client";

import { api } from "@markbase/protocol/api-client";
import { useState } from "react";
import { usePrompt } from "@markbase/ui/prompt-dialog";
import {
  Check,
  ChevronsUpDown,
  Cloud,
  FolderDown,
  FolderMinus,
  HardDrive,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Users,
  Library,
} from "lucide-react";
import { useMountedVaults } from "./use-mounted-vaults";
import { useDocsPorts } from "./ports";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import { cn } from "@markbase/ui/utils";
import { SHARED_SCOPE, isSharedScope } from "./scope";
import type { VaultMeta } from "./new-vault-modal";

/**
 * Pinned to the bottom of the documentation sidebar. Shows the focused vault by
 * name; clicking it drops UP a menu of every vault (New Vault at the top), and
 * each row carries a gear submenu for rename / delete.
 *
 * Delete is the cloud side only: the desktop/CLI daemon moves the local files to
 * the folder's `.trash/` when it sees the vault vanish — hence the warning copy.
 */
export function VaultSwitcher({
  vaults,
  focusedVaultId,
  onFocus,
  onNewVault,
  onRenamed,
  onDeleted,
  onUnmounted,
}: {
  vaults: VaultMeta[];
  focusedVaultId: string | null;
  onFocus: (id: string) => void;
  onNewVault: () => void;
  onRenamed: (vault: VaultMeta) => void;
  onDeleted: (id: string) => void;
  /** A vault was deliberately unmounted here, so it leaves the app. */
  onUnmounted: (id: string) => void;
}) {
  const ask = usePrompt();
  const [open, setOpen] = useState(false);
  // Which of these vaults are folders on this machine. Absent in a browser, where
  // the local/cloud split has no meaning and the rows stay as they were.
  const { dirs: mountedDirs, supported: knowsMounts, refresh: refreshMounts } = useMountedVaults();
  const [unmounting, setUnmounting] = useState<string | null>(null);
  // A host with no vaults port (a browser) shows no Mount or Unmount rather
  // than an item that fails when clicked.
  const { vaults: vaultsPort } = useDocsPorts();
  const canUnmount = vaultsPort !== null;
  const [mounting, setMounting] = useState<string | null>(null);
  const sharedFocused = isSharedScope(focusedVaultId);
  const focused = sharedFocused
    ? null
    : vaults.find((v) => v.id === focusedVaultId) ?? vaults[0] ?? null;

  async function rename(v: VaultMeta) {
    const next = await ask({ title: `Rename "${v.name}"`, initial: v.name, confirmLabel: "Rename" });
    const name = next?.trim();
    if (!name || name === v.name) return;
    const res = await api.request(`/api/v1/vaults/${v.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) onRenamed({ ...v, name });
    else alert("Couldn't rename the vault.");
  }

  /**
   * Give a cloud-only vault a folder on this machine.
   *
   * The vault row already exists — this is only the local half, the same call the
   * New Vault modal makes after creating one. Until now it was reachable ONLY
   * through that modal, so a vault created on another machine (or on the web)
   * could be read here but never synced to disk.
   */
  async function mount(v: VaultMeta) {
    if (!vaultsPort) return;
    setMounting(v.id);
    try {
      const first = Object.keys(mountedDirs).length === 0;
      const res = await vaultsPort.mount(v.id, v.name, first);
      // A cancelled folder picker is not a failure — say nothing and leave the
      // row alone.
      if (res.canceled) return;
      if (!res.ok) {
        alert(res.error ?? `Couldn't mount "${v.name}" here.`);
        return;
      }
      await refreshMounts();
    } finally {
      setMounting(null);
    }
  }

  async function remove(v: VaultMeta) {
    const ok = confirm(
      `Delete "${v.name}"?\n\n` +
        `All documents in this vault are removed from the cloud. On any machine ` +
        `where it's mounted, its local files are moved to the vault's .trash/ — ` +
        `they are not erased from disk.\n\nThis can't be undone.`
    );
    if (!ok) return;
    const res = await api.request(`/api/v1/vaults/${v.id}`, { method: "DELETE" });
    // 404 means the server has no such vault FOR YOU — already deleted, deleted on
    // another device, or never yours. Either way it does not belong in this list,
    // and the desired end state is the one we already have. Treating it as a
    // failure left it visible and undeletable forever: the list is an app-lifetime
    // cache, so nothing refetched it, and every retry 404'd the same way.
    if (res.ok || res.status === 404) onDeleted(v.id);
    else alert("Couldn't delete the vault.");
  }

  /**
   * Stop syncing this vault on this Mac.
   *
   * Deliberately not styled as destructive, and deliberately not called
   * "Remove": Delete (below) takes the documents out of the cloud for every
   * machine, while this takes nothing away at all — the folder and its files
   * stay exactly where they are, and mounting it again picks up where it left
   * off. The wording says "this Mac" for the same reason: everything else in
   * this menu is account-wide.
   *
   * Desktop only: a host with no vaults port has no item at all rather than
   * one that throws when clicked.
   */
  async function unmount(v: VaultMeta) {
    if (!vaultsPort) return;

    const where = mountedDirs[v.id];
    const ok = confirm(
      `Stop syncing "${v.name}" on this Mac?\n\n` +
        `It disappears from Markbase here, and your files in ${where} stay exactly ` +
        `where they are — nothing is deleted, on this Mac or in the cloud. The vault ` +
        `keeps syncing on your other machines, and mounting this folder again brings ` +
        `it back.`
    );
    if (!ok) return;

    setUnmounting(v.id);
    try {
      const res = await vaultsPort.unmount(v.id);
      if (!res.ok) {
        alert(res.error ?? "Couldn't stop syncing this vault.");
        return;
      }
      // The vault leaves the app entirely — an unmount here is "I don't work on
      // this on this Mac", not "show it as cloud-only". The registry remembers
      // that, so it stays gone across reloads; this is what makes it go now.
      onUnmounted(v.id);
    } finally {
      setUnmounting(null);
    }
  }

  // window.prompt/confirm fired synchronously inside a Radix onSelect fights the
  // menu's focus teardown — defer to the next tick, after the menu has closed.
  //
  // Waiting for Radix's own onOpenChange instead was tried, to see whether the
  // empty band under "Shared with me" came from mutating the vault list while
  // the portal was mid-teardown. It made the confirm dialog visibly late — a
  // state update, a close callback and a frame, where a macrotask had been —
  // and the theory behind it was never demonstrated: in the browser Radix
  // re-anchors a shrunk menu by itself within two frames. A slower dialog is a
  // worse bug than the gap, so this stays as it was.
  const later = (fn: () => void) => setTimeout(fn, 0);

  return (
    <div className="border-t p-2">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted data-[state=open]:bg-muted"
          >
            {sharedFocused ? (
              <Users className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Library className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">
              {sharedFocused ? "Shared with me" : focused ? focused.name : "No vault"}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-(--radix-dropdown-menu-trigger-width) min-w-60"
        >
          <DropdownMenuItem onSelect={() => later(onNewVault)} className="font-medium">
            <Plus className="size-4" />
            New vault
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {vaults.map((v) => (
            <div key={v.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onFocus(v.id);
                  setOpen(false);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Check
                  className={cn(
                    "size-4 shrink-0",
                    v.id === focused?.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                {knowsMounts &&
                  (mountedDirs[v.id] ? (
                    <HardDrive
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="Synced to a folder on this Mac"
                    />
                  ) : (
                    <Cloud
                      className="size-3.5 shrink-0 text-muted-foreground/60"
                      aria-label="Cloud only — not on this Mac"
                    />
                  ))}
              </button>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  aria-label={`${v.name} settings`}
                  className="shrink-0 [&>svg.ml-auto]:hidden"
                >
                  <Settings className="size-4 text-muted-foreground" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {knowsMounts &&
                    (mountedDirs[v.id] ? (
                      <>
                        <DropdownMenuItem disabled className="opacity-100">
                          <HardDrive className="size-4 shrink-0" />
                          <span className="min-w-0 truncate" title={mountedDirs[v.id]}>
                            {mountedDirs[v.id]}
                          </span>
                        </DropdownMenuItem>
                        {canUnmount && (
                          <DropdownMenuItem
                            onSelect={() => later(() => void unmount(v))}
                            disabled={unmounting === v.id}
                          >
                            <FolderMinus className="size-4" />
                            {unmounting === v.id ? "Stopping…" : "Stop syncing on this Mac"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                      </>
                    ) : (
                      <>
                        <DropdownMenuItem
                          onSelect={() => later(() => void mount(v))}
                          disabled={mounting === v.id}
                        >
                          <FolderDown className="size-4" />
                          {mounting === v.id ? "Mounting…" : "Mount to local folder"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ))}
                  <DropdownMenuItem onSelect={() => later(() => rename(v))}>
                    <Pencil className="size-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => later(() => remove(v))}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </div>
          ))}

          {/* Not a vault, and it must not read as one — there is no such thing
              as a shared vault: a vault has one owner, and a doc shared with
              you sits in ITS owner's vault. This is a view across them. Hence
              the labelled section rather than one more row in the list above. */}
          <DropdownMenuSeparator />
          <div className="px-1.5 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
            Views
          </div>
          <button
            type="button"
            onClick={() => {
              onFocus(SHARED_SCOPE);
              setOpen(false);
            }}
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <Check
              className={cn("size-4 shrink-0", sharedFocused ? "opacity-100" : "opacity-0")}
            />
            <Users className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">Shared with me</span>
          </button>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
