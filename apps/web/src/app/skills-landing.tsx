import Image from "next/image";
import Link from "next/link";
import { Boxes, NotebookPen } from "lucide-react";
import { Button } from "@markbase/ui/button";
import { CopyButton } from "@markbase/ui/copy-button";

const INSTALL =
  "curl -fsSL https://skills.markbase.so/install | MARKBASE_API_KEY=<your key> bash";

// Public Skills API landing (shown at the root of the skills host). Header with
// a Log in button; a two-step "get a key → run one command" install flow.
export function SkillsLanding() {
  return (
    <div className="flex min-h-svh flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt=""
              width={28}
              height={28}
              priority
              className="size-7 object-contain"
            />
            <span className="font-semibold">Skills library</span>
          </div>
          <Button asChild size="sm">
            <Link href="/login">Log in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        {/* Hero */}
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Install skills for your agent
        </h1>
        <p className="mt-3 max-w-prose text-muted-foreground">
          Pull reusable Claude Code skills into your agent, and let it record
          what it learns. Two steps: get a key, run one command.
        </p>

        {/* Step 1 — get a key (requires login) */}
        <section className="mt-10">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground">
            STEP 1
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4">
            <div>
              <p className="font-medium">Get your API key</p>
              <p className="text-sm text-muted-foreground">
                Sign in with Google to create a key for your agent.
              </p>
            </div>
            <Button asChild>
              <Link href="/login?next=/dashboard/api-keys">Get API key</Link>
            </Button>
          </div>
        </section>

        {/* Step 2 — copy & run */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground">
              STEP 2
            </p>
            <CopyButton text={INSTALL} label="Copy command" />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste your key in place of <code>&lt;your key&gt;</code> and run this
            one command:
          </p>
          <pre className="mt-3 overflow-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
            <code>{INSTALL}</code>
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Installs <code className="font-mono">personal-skill-library</code> —
            your agent can then list and install every skill you have access to.
          </p>
        </section>

        {/* What you get */}
        <section className="mt-14">
          <h2 className="text-sm font-semibold">Starting skills</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Card icon={<Boxes className="size-4" />} title="Skills">
              Install reusable Claude Code skills straight into its skills
              directory.
            </Card>
            <Card icon={<NotebookPen className="size-4" />} title="Learnings">
              Record dated notes as it works, synced back to your library.
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-3xl px-6 py-6 text-sm text-muted-foreground">
          Skills library
        </div>
      </footer>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
