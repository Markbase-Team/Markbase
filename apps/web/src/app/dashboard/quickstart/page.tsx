import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check, Lock, Terminal } from "lucide-react";
import { CLAUDE_CODE_FEATURES, type FeatureId } from "@markbase/protocol";
import { getCurrentUser } from "@/lib/supabase/server";
import { getFeatureEnv } from "@/lib/features";
import { AppHeader } from "@markbase/ui/app-header";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_CMD = "npx -y @markbase/cli@latest login";

function isFeatureId(v: string | null | undefined): v is FeatureId {
  return CLAUDE_CODE_FEATURES.some((f) => f.id === v);
}

// Shown when a user reaches a Claude-Code-only surface (Projects, Agents) without
// Claude Code installed. `?feature=` names what they were reaching for, so the
// page leads with that rather than a generic pitch.
export default async function QuickstartPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { claudeCode } = await getFeatureEnv(user.id);
  const { feature } = await searchParams;
  const wanted = isFeatureId(feature)
    ? CLAUDE_CODE_FEATURES.find((f) => f.id === feature)
    : undefined;

  return (
    <div className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="Quickstart" />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="px-4 py-6 sm:px-6">
      <div className="max-w-3xl">
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          {claudeCode ? (
            <>
              <Check className="size-3.5" /> Claude Code connected
            </>
          ) : (
            <>
              <Lock className="size-3.5" /> Claude Code not detected
            </>
          )}
        </div>

        <h1 className="mt-4 text-3xl font-bold tracking-tight">
          {wanted ? `${wanted.name} needs Claude Code` : "Connect Claude Code"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          Documents work in the browser on their own. The rest of Markbase is your
          own Claude Code doing the work on your machine — so those features stay
          locked until we can see it there.
        </p>

        <ol className="mt-10 space-y-8">
          <li>
            <h2 className="text-sm font-semibold">1. Install Claude Code</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              If you already have it, skip ahead — it just needs to be on your{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">PATH</code>.
            </p>
            <a
              href="https://claude.com/claude-code"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4"
            >
              claude.com/claude-code
              <ArrowRight className="size-3.5" />
            </a>
          </li>

          <li>
            <h2 className="text-sm font-semibold">
              2. Run this in your terminal
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              It authorizes this machine and starts the worker that runs your
              tickets. Re-run it any time — that&apos;s also how a fresh Claude
              Code install gets noticed.
            </p>
            <div className="mt-3 flex items-center gap-2.5 rounded-lg border bg-muted/40 px-3.5 py-3 font-mono text-sm">
              <Terminal className="size-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 overflow-x-auto">{LOGIN_CMD}</code>
            </div>
          </li>

          <li>
            <h2 className="text-sm font-semibold">3. Reload this page</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {claudeCode
                ? "Done — Claude Code is connected and everything below is unlocked."
                : "Once the worker reports in, the locked features below turn on."}
            </p>
          </li>
        </ol>

        <h2 className="mt-14 text-sm font-semibold">
          What Claude Code unlocks
        </h2>
        <ul className="mt-4 space-y-4">
          {CLAUDE_CODE_FEATURES.map((f) => (
            <li key={f.id} className="flex gap-3">
              {claudeCode ? (
                <Check className="mt-0.5 size-4 shrink-0" />
              ) : (
                <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div>
                <p className="text-sm font-medium">{f.name}</p>
                <p className="text-sm text-muted-foreground">{f.blurb}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-12 text-sm text-muted-foreground">
          Nothing to install right now?{" "}
          <Link
            href="/dashboard/documents"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Go to Documents
          </Link>{" "}
          — they work without it.
        </p>
      </div>
      </main>
      </div>
    </div>
  );
}
