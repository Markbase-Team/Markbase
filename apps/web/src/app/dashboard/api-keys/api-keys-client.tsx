"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, KeySquare, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";
import { cn } from "@/lib/utils";
import { AppHeader } from "@markbase/ui/app-header";

type ApiScope = "read" | "write";
type Capability = "owner" | "editor" | "commenter" | "viewer";
type ApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiScope[];
  last_used_at: string | null;
  created_at: string;
  capability: Capability | null;
};

const ALL_SCOPES: ApiScope[] = ["read", "write"];
const ALL_CAPS: Capability[] = ["owner", "editor", "commenter", "viewer"];
const CAP_HELP: Record<Capability, string> = {
  owner: "full access — create, edit, share, delete (default)",
  editor: "read + edit documents, but not share or delete",
  commenter: "read + comment only",
  viewer: "read only",
};

function copy(text: string, label = "Copied") {
  navigator.clipboard.writeText(text).then(
    () => toast.success(label),
    () => toast.error("Couldn't copy")
  );
}

function fmtDate(s: string | null): string {
  if (!s) return "never";
  return new Date(s).toLocaleString();
}

export function ApiKeysClient() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["read", "write"]);
  const [capability, setCapability] = useState<Capability>("owner");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/api-keys");
        const d: { apiKeys?: ApiKey[] } = await r.json();
        if (r.ok) setKeys(d.apiKeys ?? []);
      } catch {
        // ignore
      }
    })();
  }, []);

  function toggleScope(s: ApiScope) {
    setScopes((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    if (scopes.length === 0) {
      toast.error("Pick at least one scope");
      return;
    }
    setCreating(true);
    setNewToken(null);
    try {
      const r = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          // owner = full access = the default (stored as null server-side too).
          capability: capability === "owner" ? null : capability,
        }),
      });
      const d: { apiKey?: ApiKey; token?: string; error?: string } =
        await r.json();
      if (!r.ok || !d.apiKey || !d.token) throw new Error(d.error ?? "Failed");
      setNewToken(d.token);
      setKeys((prev) => [d.apiKey!, ...prev]);
      setName("");
      toast.success("API key created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create key");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (
      !confirm(
        "Revoke this key? Any agent using it loses access immediately."
      )
    )
      return;
    setKeys((prev) => prev.filter((k) => k.id !== id));
    try {
      await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" });
    } catch {
      // best-effort
    }
  }

  const install = buildInstallSnippet();

  return (
    <main className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="API Keys" />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      <p className="text-sm text-muted-foreground sm:text-base">
        Give an agent (e.g. Claude) a key to read and push skills, learnings, and
        terms. You can call the same API key-free while signed in.
      </p>
      {/* Create a key. */}
      <form onSubmit={create} className="mt-6 space-y-3 rounded-lg border bg-card p-4">
        <div className="space-y-2">
          <Label htmlFor="ak-name">Key name</Label>
          <Input
            id="ak-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Claude on my laptop"
          />
        </div>
        <div className="space-y-2">
          <Label>Scopes</Label>
          <div className="flex gap-2">
            {ALL_SCOPES.map((s) => {
              const on = scopes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm capitalize transition-colors",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {on && <Check className="size-3.5" />}
                  {s}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            read = list skills/terms/learnings · write = create them.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Document access</Label>
          <div className="flex flex-wrap gap-2">
            {ALL_CAPS.map((c) => {
              const on = capability === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCapability(c)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm capitalize transition-colors",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {on && <Check className="size-3.5" />}
                  {c}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            The most this key can do to your documents: {CAP_HELP[capability]}.
          </p>
        </div>
        <Button type="submit" disabled={creating || !name.trim()}>
          {creating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Create key
        </Button>
      </form>

      {/* The freshly-minted token — shown once. */}
      {newToken && (
        <div className="mt-4 rounded-lg border border-[#e5ff6e] bg-[#e5ff6e]/15 p-4">
          <p className="text-sm font-medium">
            Copy your key now — it won&apos;t be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-2 py-1.5 font-mono text-sm">
              {newToken}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copy(newToken, "Key copied")}
            >
              <Copy className="size-4" />
              Copy
            </Button>
          </div>
        </div>
      )}

      {/* Existing keys. */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold">Your keys</h2>
        <div className="mt-3 space-y-2">
          {keys.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No keys yet.
            </p>
          ) : (
            keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
              >
                <KeySquare className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{k.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <code className="font-mono">{k.key_prefix}…</code> ·{" "}
                    {k.scopes.join(", ")} ·{" "}
                    <span className="capitalize">{k.capability ?? "owner"}</span>{" "}
                    · last used {fmtDate(k.last_used_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(k.id)}
                  aria-label="Revoke key"
                  title="Revoke key"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Hand-off: install the entry-point skill that knows the whole API. */}
      <div className="mt-10">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Give Claude access</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(install, "Command copied")}
          >
            <Copy className="size-4" />
            Copy command
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Create a key above, paste it below, and run this. It installs the{" "}
          <code className="font-mono">personal-skill-library</code> skill — from
          there Claude can list and install every other skill, and record
          learnings &amp; terms.
        </p>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
          <code>{install}</code>
        </pre>
      </div>
      </div>
    </main>
  );
}

// A copy-paste shell snippet that installs the entry-point skill. Once it's in
// place, that skill documents the rest of the API to the agent. The Skills API
// is served on its own host (skills.markbase.so), separate from this app.
const SKILLS_API_BASE = "https://skills.markbase.so/api/v1";

function buildInstallSnippet(): string {
  return [
    `export MARKBASE_API_KEY="<paste your key>"`,
    ``,
    `mkdir -p ~/.claude/skills/personal-skill-library`,
    `curl -s -H "Authorization: Bearer $MARKBASE_API_KEY" \\`,
    `  "${SKILLS_API_BASE}/skills/personal-skill-library?format=raw" \\`,
    `  -o ~/.claude/skills/personal-skill-library/SKILL.md`,
    ``,
    `# Then tell Claude: "use the personal-skill-library skill to list and install skills"`,
  ].join("\n");
}
