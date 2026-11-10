"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { useProject, type Secret } from "./project-context";

// Per-project secrets. The secrets list + create/delete live in the project
// context (optimistic, shared); reveal/copy/the add form stay local here.
export function SecretsManager({ configured }: { configured: boolean }) {
  const { secrets, secretsLoading, addSecret, removeSecret } = useProject();

  // Revealed plaintext values, keyed by secret id (cleared on hide).
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealingId, setRevealingId] = useState<string | null>(null);

  // Add-secret form state.
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);

  async function submitSecret() {
    const n = name.trim();
    if (!n || !value || adding) return;
    setAdding(true);
    const ok = await addSecret({ name: n, description, value });
    setAdding(false);
    if (ok) {
      setOpen(false);
      setName("");
      setDescription("");
      setValue("");
    }
  }

  // Reveal: fetch + decrypt server-side, or hide if already shown.
  async function toggleReveal(secret: Secret) {
    if (revealed[secret.id] !== undefined) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[secret.id];
        return next;
      });
      return;
    }
    setRevealingId(secret.id);
    try {
      const res = await fetch(`/api/admin/secrets/${secret.id}/reveal`, {
        method: "POST",
      });
      const data: { value?: string; error?: string } = await res.json();
      if (!res.ok || data.value === undefined) {
        throw new Error(data.error ?? "Failed");
      }
      setRevealed((r) => ({ ...r, [secret.id]: data.value! }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reveal");
    } finally {
      setRevealingId(null);
    }
  }

  async function copy(secret: Secret) {
    try {
      let plaintext = revealed[secret.id];
      if (plaintext === undefined) {
        const res = await fetch(`/api/admin/secrets/${secret.id}/reveal`, {
          method: "POST",
        });
        const data: { value?: string; error?: string } = await res.json();
        if (!res.ok || data.value === undefined) {
          throw new Error(data.error ?? "Failed");
        }
        plaintext = data.value;
      }
      await navigator.clipboard.writeText(plaintext);
      toast.success("Copied");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't copy");
    }
  }

  function remove(secret: Secret) {
    if (!confirm(`Delete "${secret.name}"? This can't be undone.`)) return;
    removeSecret(secret.id);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-4" />
          API keys, encrypted at rest (AES-256-GCM).
        </p>
        <Button onClick={() => setOpen(true)} disabled={!configured}>
          <Plus className="size-4" />
          New secret
        </Button>
      </div>

      {!configured && (
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Encryption key not configured</p>
            <p className="mt-0.5">
              Set <code className="font-mono">SECRETS_ENCRYPTION_KEY</code> in the
              server environment (generate with{" "}
              <code className="font-mono">openssl rand -base64 32</code>) before
              storing secrets.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-2">
        {secretsLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : secrets.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No secrets for this project yet.
          </p>
        ) : (
          secrets.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
            >
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-sm font-medium">
                    {s.name}
                  </span>
                  {s.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {s.description}
                    </span>
                  )}
                </div>
                <code className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                  {revealed[s.id] ?? s.preview}
                </code>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => toggleReveal(s)}
                disabled={revealingId === s.id}
                aria-label={revealed[s.id] !== undefined ? "Hide" : "Reveal"}
                title={revealed[s.id] !== undefined ? "Hide" : "Reveal"}
              >
                {revealingId === s.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : revealed[s.id] !== undefined ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => copy(s)}
                aria-label="Copy"
                title="Copy"
              >
                <Copy className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => remove(s)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete"
                title="Delete"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Add-secret dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New secret</DialogTitle>
            <DialogDescription>
              The value is encrypted before it&apos;s stored and never shown in
              lists.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSecret();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="sec-name">Name</Label>
              <Input
                id="sec-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="OPENAI_API_KEY"
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sec-desc">Description (optional)</Label>
              <Input
                id="sec-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this key is for"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sec-value">Value</Label>
              <Input
                id="sec-value"
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="sk-…"
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!name.trim() || !value || adding}>
                {adding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Save secret
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
