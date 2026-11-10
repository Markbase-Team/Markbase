import { AlertTriangle, Bot, Plus } from "lucide-react";
import {
  getWorkerPresence,
  isVersionBehind,
  listProjects,
  MIN_SPAWN_WORKER_VERSION,
  MIN_WORKER_VERSION,
} from "@markbase/protocol";
import { listApiKeys } from "@markbase/node";
import { listAgentSessions, type AgentSession, type Provider } from "@markbase/protocol";
import type { FeaturePageProps } from "@markbase/ui/page-host";
import { Badge } from "@markbase/ui/badge";
import { cn } from "@markbase/ui/utils";
import { AppHeader } from "@markbase/ui/app-header";
import { CreateAgentButton, EndAgentButton } from "../../../ui";

const ENDABLE: AgentSession["status"][] = ["active", "idle", "pending"];

// Owner-only view of the agents that have joined: the connections (API keys, one
// per connected provider) and their named sessions, grouped by provider. Read
// only for now — creating and continuing sessions come in a later phase.

const PROVIDER_LABEL: Record<Provider, string> = {
  claude_code: "Claude Code",
  claude_desktop: "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  unknown: "Unknown",
};
const PROVIDER_ORDER: Provider[] = [
  "claude_code",
  "claude_desktop",
  "codex",
  "cursor",
  "unknown",
];

const STATUS_META: Record<
  AgentSession["status"],
  { label: string; className: string }
> = {
  active: { label: "Active", className: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" },
  idle: { label: "Idle", className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
  pending: { label: "Pending", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  missing: { label: "Local memory deleted", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  ended: { label: "Ended", className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
};

function fmt(ts: string | null): string {
  return ts ? new Date(ts).toLocaleString() : "never";
}

export default async function AgentsPage({ host }: FeaturePageProps) {
  const user = await host.viewer();
  // `return` rather than a bare call: TS only narrows on a never-returning
  // call through an explicitly typed reference, and a destructured `host` is not.
  if (!user) return host.redirect("/login");
  // Every session on this page is a Claude Code session.
  await host.requireFeature("agents");

  const [connections, sessions, projects, worker] = await Promise.all([
    listApiKeys(user.id),
    listAgentSessions(user.id),
    listProjects(user.id),
    getWorkerPresence(user.id),
  ]);
  // Projects with a local repo the worker can launch a session in.
  const spawnProjects = projects
    .filter((p) => !!p.local_path)
    .map((p) => ({ slug: p.slug, name: p.name }));

  // Surface why auto-spawn / dispatch might not fire: no worker, or one too old
  // to drain the spawn queue — or, since security lockdown stage 2, one still
  // reaching the database directly, which stops working at the cutover.
  const minVersion = isVersionBehind(MIN_SPAWN_WORKER_VERSION, MIN_WORKER_VERSION)
    ? MIN_WORKER_VERSION
    : MIN_SPAWN_WORKER_VERSION;
  const workerState: "offline" | "outdated" | "ok" = !worker.connected
    ? "offline"
    : isVersionBehind(worker.version, minVersion)
      ? "outdated"
      : "ok";

  // Sessions grouped by provider, in a stable provider order, groups with rows only.
  const byProvider = PROVIDER_ORDER.map((provider) => ({
    provider,
    rows: sessions.filter((s) => s.provider === provider),
  })).filter((g) => g.rows.length > 0);

  return (
    <main className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="Agents" />

      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-3 py-4">
        <p className="text-sm text-muted-foreground sm:text-base">
          The agents connected to your workspace and their sessions. Connect an
          agent from Claude, Codex, or another tool — each session ties a name to
          a resumable conversation.
        </p>
        {workerState !== "ok" && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {workerState === "offline" ? (
              <span>
                Your worker is offline — agent auto-spawn and ticket dispatch
                won&apos;t run until it&apos;s up. Start it with{" "}
                <code className="font-mono">npx @markbase/cli@latest start</code>.
              </span>
            ) : (
              <span>
                Your worker is on <span className="font-medium">v{worker.version}</span>{" "}
                — tickets and agents need v{minVersion}+. Stop it and
                restart with{" "}
                <code className="font-mono">npx @markbase/cli@latest start</code>.
              </span>
            )}
          </div>
        )}

        {/* Connections */}
        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Connections</h2>
            <host.Link
              href={host.routes.apiKeys()}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              <Plus className="size-4" />
              Connect an agent
            </host.Link>
          </div>
          {connections.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No agents connected yet. Run{" "}
              <code className="font-mono">npx @markbase/cli mcp install</code> to
              connect Claude.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {connections.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <Bot className="size-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <Badge variant="secondary" className="font-normal">
                        {PROVIDER_LABEL[c.provider]}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      <code className="font-mono">{c.key_prefix}…</code> ·{" "}
                      <span className="capitalize">{c.capability ?? "owner"}</span> ·
                      last used {fmt(c.last_used_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Sessions grouped by provider */}
        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Sessions</h2>
            <CreateAgentButton projects={spawnProjects} />
          </div>
          {byProvider.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No sessions yet. Sessions appear here once an agent starts working.
            </p>
          ) : (
            <div className="mt-3 space-y-6">
              {byProvider.map(({ provider, rows }) => (
                <div key={provider}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    <Bot className="size-3.5" />
                    {PROVIDER_LABEL[provider]}
                    <span className="text-muted-foreground/60">· {rows.length}</span>
                  </div>
                  <div className="divide-y rounded-lg border">
                    {rows.map((s) => {
                      const meta = STATUS_META[s.status];
                      const repo = typeof s.context?.repo_cwd === "string" ? s.context.repo_cwd : null;
                      return (
                        <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{s.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {repo ? <span className="font-mono">{repo}</span> : "—"} · last active {fmt(s.last_active)}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn("shrink-0 border-transparent font-normal", meta.className)}
                          >
                            {meta.label}
                          </Badge>
                          {ENDABLE.includes(s.status) && <EndAgentButton id={s.id} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
