"use client";

import { api } from "@markbase/protocol/api-client";
import { useState } from "react";
import { MAC_DOWNLOAD_URL } from "@markbase/protocol/downloads";
import { Download, FolderInput, Library, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";
import { useDocsPorts } from "./ports";
import { sanitizePathSegment } from "@markbase/protocol/shared-vault";

export type VaultMeta = { id: string; name: string };

/**
 * Create a vault. A vault is a cloud row (name + owner); its LOCAL folder is
 * per-machine, so "where it lives" is a desktop-only step — the web can't pick a
 * filesystem path. On desktop we pre-fill the first vault's folder as
 * `~/Markbase`; on web we just take the name and tell the user to mount it in the
 * desktop app.
 *
 * The web path creates the vault for real — the same `POST /api/v1/vaults` the
 * desktop calls, which seeds the Welcome document into an account's first vault.
 * This used to be refused in a browser ("a vault is a folder that syncs, and
 * the web has no folder"), which made the Mac download the only way out of the
 * empty state. A self-hosted Markbase is used from the browser by people who
 * will never install the app, and the data model never needed the folder: the
 * row is the vault, documents live in it, and mounting is a registry entry the
 * desktop app's Vaults menu or `markbase vault mount` adds to an EXISTING vault,
 * on whichever machine, whenever. So the rule now: the name makes the vault;
 * the folder is a secondary, per-machine step, said as such and never the gate.
 */
export function NewVaultModal({
  open,
  onOpenChange,
  onCreated,
  isFirstVault,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (vault: VaultMeta) => void;
  /** The very first vault defaults its local folder to ~/Markbase (desktop). */
  isFirstVault: boolean;
}) {
  // Only a host with a vaults port can give the vault a folder — so "is this
  // the desktop" is "is there a vaults port". A browser creates the vault and
  // leaves the folder to the desktop app.
  const { vaults } = useDocsPorts();
  const isDesktop = vaults !== null;
  // The first vault arrives named, so the folder row can show where it goes
  // (~/Markbase/First Vault) and Create works at once; the text is selected on
  // focus, so typing replaces it. Later vaults start blank — a person with one
  // vault knows what the next one is for.
  const FIRST_VAULT_NAME = "First Vault";
  const [name, setName] = useState(isFirstVault ? FIRST_VAULT_NAME : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A folder picked BEFORE the vault exists. The mount API needs a vault id, which
  // only exists after Create — so the path is held here and handed over after.
  const [folder, setFolder] = useState<string | null>(null);

  // Cleared on the render that opens it, not from an effect: the dialog must
  // never paint the last attempt's name or error, and an effect would show them
  // for a frame first.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(isFirstVault ? FIRST_VAULT_NAME : "");
      setError(null);
      setSaving(false);
      setFolder(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    // On desktop, settle the folder BEFORE the vault exists. The one picked,
    // or the default ~/Markbase/<name>, may already belong to another vault on
    // this Mac — the default one too, when a vault of the same name was
    // mounted here by another account — and a refusal after Create would
    // leave a vault that was told "no". Refused: say why and open the picker;
    // nothing is created until a folder is settled or the picker is dismissed.
    let dir = folder ?? undefined;
    if (vaults) {
      const check = await vaults.checkFolder(trimmed, dir);
      if (check.refused) {
        setError(check.refused);
        const picked = await vaults.chooseFolder(trimmed, isFirstVault);
        if (!picked.dir) {
          setSaving(false);
          return;
        }
        dir = picked.dir;
        setFolder(picked.dir);
        setError(null);
      } else {
        dir = check.dir;
      }
    }
    try {
      const res = await api.request("/api/v1/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data: { vault?: VaultMeta; error?: string } = await res.json();
      if (!res.ok || !data.vault) {
        setError(data.error ?? "Couldn't create the vault.");
        return;
      }
      onCreated(data.vault);
      if (vaults) {
        // On desktop, mount the new vault to a local folder now. Best effort: the
        // native picker owns its own errors/cancel, and the vault already exists in
        // the cloud regardless — it can be mounted later from the Vaults menu.
        try {
          await vaults.mount(data.vault.id, data.vault.name, isFirstVault, dir);
        } catch {
          // Mount is optional; never block the created vault on it.
        }
      } else {
        // The created state, in a browser. The shell swaps this dialog for the
        // full one the moment the first vault lands (the empty state is its own
        // tree), so a "created" view inside the dialog would not survive to be
        // seen. A toast does, and it carries the one thing worth saying after
        // Create here: the folder is the desktop app's step, with the link —
        // secondary, after the vault exists, not before it.
        toast.success(`"${data.vault.name}" is ready`, {
          description: "It syncs to a folder on your Mac through the desktop app.",
          action: {
            label: "Download for Mac",
            onClick: () => window.open(MAC_DOWNLOAD_URL, "_blank", "noopener"),
          },
        });
      }
      onOpenChange(false);
    } catch {
      setError("Couldn't create the vault.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Open the native folder picker now, rather than after Create.
   *
   * The row below LOOKS like a chooser — dashed border, folder icon — so clicking
   * it has to open one. It used to be inert text, and the picker only appeared
   * after Create, which reads as "nothing happened".
   *
   */
  async function pickFolder() {
    if (!vaults) return;
    const picked = await vaults.chooseFolder(name.trim(), isFirstVault);
    if (picked.dir) {
      setFolder(picked.dir);
      setError(null);
    } else if (picked.refused) {
      // The host already said why, in its own dialog. Nothing is kept: Create
      // goes to the default folder unless another one is picked.
      setFolder(null);
      setError("That folder can't hold this vault. Pick another, or leave it to the default.");
    }
  }

  const canPickNow = vaults !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library className="size-5" />
            {isFirstVault ? "Create your first vault" : "New vault"}
          </DialogTitle>
          <DialogDescription>
            {!isDesktop
              ? // In a browser the folder is not part of what Create does, so
                // the definition leads with what it does make.
                "A vault holds a set of documents — Work, Personal, a team wiki. The desktop app can sync it to a folder on your Mac as markdown, both ways."
              : isFirstVault
                ? "A vault is one local folder for all your docs — new, or one you already have. Its markdown syncs both ways."
                : "A vault is one local folder that syncs all its markdown to the cloud."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="vault-name">Name</Label>
            <Input
              id="vault-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Work, Personal, Team wiki…"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Local folder</Label>
            {canPickNow ? (
              <button
                type="button"
                onClick={() => void pickFolder()}
                className="flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:border-solid hover:text-foreground"
              >
                <FolderInput className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {folder ??
                    // The folder Create will use unless another is picked: one of
                    // its own inside ~/Markbase, named after the vault. Shown as
                    // the real path, live, because "defaults to ~/Markbase" used
                    // to mean "the picker opens there", and Create then asked
                    // anyway — which read as the mount not having happened.
                    `~/Markbase/${name.trim() ? sanitizePathSegment(name.trim()) : "<name>"} — or choose another folder`}
                </span>
              </button>
            ) : isDesktop ? (
              <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
                <FolderInput className="size-4 shrink-0" />
                {`Defaults to ~/Markbase/${name.trim() ? sanitizePathSegment(name.trim()) : "<name>"} — you can choose a different folder after creating.`}
              </p>
            ) : (
              // A browser has no folder to offer, and this row says so as a
              // secondary line — the vault is created either way, and the
              // folder is added later, on a Mac, from the desktop app. Not a
              // chooser (nothing dashed to click), and not a gate: the download
              // is a link inside the sentence, and Create stays Create.
              <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                <FolderInput className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  Added later, on your Mac: the desktop app syncs this vault to a
                  folder of your choice.{" "}
                  <a
                    href={MAC_DOWNLOAD_URL}
                    className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    Download for Mac
                    <Download className="size-3.5" />
                  </a>
                </span>
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Create vault
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
