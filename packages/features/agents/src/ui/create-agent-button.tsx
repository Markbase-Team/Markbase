"use client";

import { useEffect, useState } from "react";
import { useNavigation } from "@markbase/ui/navigation";
import { toast } from "sonner";
import { Check, Copy, Loader2, Plus, Rocket } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";

const PROVIDERS = [
  { value: "claude_code", label: "Claude Code" },
  { value: "claude_desktop", label: "Claude Desktop" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
];

const REGISTER_ONLY = "__register__";

// Create a named agent. For Claude Code + a project with a local repo, the local
// worker auto-launches a session seeded with "Hi, your name is <name>". Otherwise
// it's register-and-claim: you get a token to wire into the agent's MCP config.
export function CreateAgentButton({
  projects,
}: {
  projects: { slug: string; name: string }[];
}) {
  const nav = useNavigation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("claude_code");
  const [project, setProject] = useState(projects[0]?.slug ?? REGISTER_ONLY);
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [spawnedIn, setSpawnedIn] = useState<string | null>(null);
  const [spawnedSessionId, setSpawnedSessionId] = useState<string | null>(null);
  const [spawnStatus, setSpawnStatus] = useState<"launching" | "live" | "timeout">(
    "launching"
  );
  const [copied, setCopied] = useState(false);

  // The project picker only applies to a worker-spawnable provider.
  const canSpawn = provider === "claude_code" && projects.length > 0;

  // After a spawn, poll until the worker binds the session (Active), or give up
  // with a hint that the worker may be offline/outdated.
  useEffect(() => {
    if (!spawnedSessionId || spawnStatus !== "launching") return;
    let cancelled = false;
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      try {
        const r = await fetch("/api/v1/agent-sessions");
        const d: { sessions?: { id: string; status: string }[] } = await r.json();
        const s = (d.sessions ?? []).find((x) => x.id === spawnedSessionId);
        if (!cancelled && s?.status === "active") {
          setSpawnStatus("live");
          nav.refresh();
          clearInterval(iv);
          return;
        }
      } catch {
        // transient — keep polling
      }
      if (!cancelled && tries >= 15) {
        setSpawnStatus("timeout");
        clearInterval(iv);
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [spawnedSessionId, spawnStatus, nav]);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    const useProject = canSpawn && project !== REGISTER_ONLY ? project : undefined;
    try {
      const r = await fetch("/api/v1/agent-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, name: name.trim(), project: useProject }),
      });
      const d: {
        session?: { id: string; session_token: string };
        spawning?: boolean;
        error?: string;
      } = await r.json();
      if (!r.ok || !d.session) throw new Error(d.error ?? "Failed");
      if (d.spawning) {
        setSpawnedIn(projects.find((p) => p.slug === useProject)?.name ?? "your repo");
        setSpawnedSessionId(d.session.id);
        setSpawnStatus("launching");
      } else {
        setToken(d.session.session_token);
      }
      setName("");
      nav.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create agent");
    } finally {
      setCreating(false);
    }
  }

  const envLine = `MARKBASE_SESSION_TOKEN=${token ?? ""}`;

  function close() {
    setOpen(false);
    setToken(null);
    setSpawnedIn(null);
    setSpawnedSessionId(null);
    setSpawnStatus("launching");
    setName("");
    setCopied(false);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Create agent
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create agent</DialogTitle>
            <DialogDescription>
              Claude Code launches automatically. Other agents get a token.
            </DialogDescription>
          </DialogHeader>

          {spawnedIn ? (
            <div className="space-y-3">
              {spawnStatus === "live" ? (
                <p className="inline-flex items-center gap-2 text-sm font-medium">
                  <Check className="size-4 text-[#3a9e00]" />
                  Session is live in {spawnedIn}.
                </p>
              ) : spawnStatus === "timeout" ? (
                <p className="inline-flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                  <Rocket className="size-4" />
                  Still launching — check your worker.
                </p>
              ) : (
                <p className="inline-flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="size-4 animate-spin" />
                  Launching in {spawnedIn}…
                </p>
              )}
              <DialogFooter>
                <Button onClick={close}>Done</Button>
              </DialogFooter>
            </div>
          ) : token ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Add to the agent&apos;s MCP config:
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs">
                  {envLine}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(envLine).then(
                      () => {
                        setCopied(true);
                        toast.success("Copied");
                      },
                      () => toast.error("Couldn't copy")
                    );
                  }}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={close}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={create} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Refactor auth"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-provider">Provider</Label>
                <select
                  id="agent-provider"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {canSpawn && (
                <div className="space-y-2">
                  <Label htmlFor="agent-project">Launch in</Label>
                  <select
                    id="agent-project"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {projects.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name}
                      </option>
                    ))}
                    <option value={REGISTER_ONLY}>
                      Register only (I&apos;ll wire the token)
                    </option>
                  </select>
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={creating || !name.trim()}>
                  {creating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Create
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
