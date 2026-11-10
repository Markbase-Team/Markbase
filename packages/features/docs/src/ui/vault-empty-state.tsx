"use client";

import { CloudOff, Library, Plus, RotateCw } from "lucide-react";

/**
 * Shown when the vault list couldn't be loaded and this machine has no mounted
 * vault to show instead. NOT the onboarding screen: a server that is down says
 * nothing about whether the user has vaults, and "Create your first vault" would
 * tell someone with a full vault that it's gone.
 */
export function VaultLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border bg-muted">
        <CloudOff className="size-7" />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">
        Couldn&apos;t load your vaults
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The server didn&apos;t answer, so we can&apos;t list your vaults right now.
        Nothing has been deleted — your documents are where you left them.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-7 inline-flex items-center justify-center gap-2 rounded-full bg-[#e5ff6e] px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:shadow-[0_0_24px_rgba(229,255,110,0.7)]"
      >
        <RotateCw className="size-4" />
        Try again
      </button>
    </div>
  );
}

/**
 * Shown behind the first-vault dialog when the user has no vaults yet. The
 * dialog opens by itself (DocsShell) — creating and picking a folder are one
 * flow, and the two buttons that used to stand here for them were a choice
 * with no difference. This is what remains if the dialog is dismissed.
 */
export function VaultEmptyState({ onNewVault }: { onNewVault: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border bg-muted">
        <Library className="size-7" />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">
        Create your first vault
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A vault is one local folder for all your docs — <code>CLAUDE.md</code>,{" "}
        <code>AGENTS.md</code>, design docs, team wikis, and any existing
        markdown. We sync files ending in <strong>.md</strong> (plus the images
        they reference); the folder&apos;s other files are left untouched.
      </p>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onNewVault}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-[#e5ff6e] px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:shadow-[0_0_24px_rgba(229,255,110,0.7)]"
        >
          <Plus className="size-4" />
          Create your first vault
        </button>
      </div>
    </div>
  );
}
