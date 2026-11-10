import Link from "next/link";
import Image from "next/image";
import { Outfit } from "next/font/google";
import {
  ArrowRight,
  Bell,
  GitPullRequest,
  Smartphone,
  TerminalSquare,
} from "lucide-react";
import { SiteFooter } from "@/components/site-footer";

// Outfit — the exact font the Amplyo landing uses. Applied to the whole landing
// so body + headings share the one rounded-geometric family.
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Amplyo brand tokens (from the reference landing).
const MUTED = "#52525b";
const DIM = "#a1a1aa";
const DIVIDER = "border-[#efeff1]";
const SURFACE = "#f7f7f8";

const accentBtn =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#e5ff6e] px-6 py-3 text-sm font-semibold text-neutral-900 transition hover:shadow-[0_0_28px_rgba(229,255,110,0.85)] active:scale-[0.98]";

// Marketing landing for the apex host (markbase.so), built to match the Amplyo
// landing: white canvas, near-black ink, lime accent, Outfit font, generous
// section rhythm divided by hairline borders. Self-contained so it doesn't
// inherit the app's theme.
export function TicketLanding() {
  return (
    <div className={`${outfit.className} min-h-svh bg-white text-neutral-900`}>
      {/* Nav */}
      <header className={`border-b ${DIVIDER}`}>
        <div className="flex w-full items-center justify-between px-6 py-4 md:px-10">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.png"
              alt=""
              width={28}
              height={28}
              className="size-7 object-contain"
            />
            <span className="text-lg font-bold tracking-tight">
              Markbase&apos;s
            </span>
          </div>
          <div className="flex items-center gap-6">
            <Link
              href="/login"
              className="text-sm font-medium text-neutral-700 transition-colors hover:text-neutral-900"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-[#e5ff6e] px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:shadow-[0_0_24px_rgba(229,255,110,0.7)]"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-20 pb-12 md:pt-32 md:pb-20">
        <div className="mx-auto max-w-5xl">
          <span
            className="inline-block rounded-full border border-neutral-300 px-3 py-1 text-xs font-medium"
            style={{ color: MUTED }}
          >
            For independent developers
          </span>
          <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
            Run your dev business{" "}
            <span className="whitespace-nowrap bg-[#e5ff6e] px-2">
              from your phone.
            </span>
          </h1>
          <p
            className="mt-6 max-w-xl text-base leading-relaxed md:text-lg"
            style={{ color: MUTED }}
          >
            Customers submit requests. You triage from anywhere. Your Claude
            Code worker ships the code.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/login" className={accentBtn}>
              Open your dashboard <ArrowRight className="size-4" />
            </Link>
            <a
              href="#worker"
              className="inline-flex items-center rounded-full border border-neutral-300 px-6 py-3 text-sm font-semibold transition hover:bg-neutral-50"
            >
              How the worker works
            </a>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className={`border-t ${DIVIDER} px-6 py-24 md:py-32`}>
        <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-3">
          <Feature
            Icon={Smartphone}
            title="Your customers, organized"
            body="Customers submit to a request page. You triage and track status from your phone."
          />
          <Feature
            Icon={GitPullRequest}
            title="The work ships itself"
            body="Kick off a ticket and Claude Code opens a pull request while you handle the next client."
          />
          <Feature
            Icon={Bell}
            title="Email becomes business"
            body="Connect Gmail. Client emails and asks become tickets, sorted automatically."
          />
        </div>
      </section>

      {/* Step away, the work still ships */}
      <section className={`border-t ${DIVIDER} px-6 py-24 md:py-32`}>
        <div className="mx-auto grid max-w-5xl items-center gap-12 md:grid-cols-2 md:gap-24">
          <div>
            <h2 className="text-3xl font-bold leading-tight tracking-tight md:text-5xl">
              Step away. The code still ships.
            </h2>
            <p className="mt-5 text-base md:text-lg" style={{ color: MUTED }}>
              The cloud only <em>queues</em> jobs. A <strong>worker</strong> on
              your machine runs Claude Code on your real repos and tools. Be
              with a client or out while the work gets done.
            </p>
            <ul className="mt-7 space-y-3 text-sm" style={{ color: MUTED }}>
              <Bullet>Tap Run from anywhere. The worker picks it up in seconds.</Bullet>
              <Bullet>Live progress streams to the board. Review the PR when it lands.</Bullet>
              <Bullet>Scoped to your account. A worker only runs your tickets.</Bullet>
            </ul>
          </div>
          <div className={`rounded-2xl border ${DIVIDER} bg-white p-5 shadow-sm`}>
            <div
              className="flex items-center gap-2 text-xs font-medium"
              style={{ color: MUTED }}
            >
              <span className="size-2 rounded-full bg-emerald-500" /> Worker
              connected
            </div>
            <div className="mt-4 space-y-2">
              {[
                "Add a property value pair system",
                "Mobile UI for the admin board",
                "Set up cron to classify unread",
              ].map((t, i) => (
                <div
                  key={t}
                  className={`flex items-center justify-between rounded-lg border ${DIVIDER} px-3 py-2 text-sm`}
                >
                  <span className="truncate">{t}</span>
                  <span
                    className={
                      i === 0
                        ? "rounded-full bg-[#e5ff6e] px-2 py-0.5 text-xs font-semibold"
                        : "text-xs"
                    }
                    style={i === 0 ? undefined : { color: DIM }}
                  >
                    {i === 0 ? "Running" : "Queued"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Worker install */}
      <section id="worker" className={`border-t ${DIVIDER} px-6 py-24 md:py-32`}>
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2" style={{ color: MUTED }}>
            <TerminalSquare className="size-5" />
            <span className="text-xs font-semibold tracking-wide uppercase">
              Set up the worker
            </span>
          </div>
          <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight md:text-5xl">
            Install once. It runs Claude in the background.
          </h2>
          <p className="mt-4 max-w-2xl text-base md:text-lg" style={{ color: MUTED }}>
            The worker is a tiny CLI, <code className="font-mono">markbase</code>.
            Installing it connects your account and registers a background
            service.
          </p>

          <div className="mt-10 grid gap-8 md:grid-cols-[1.1fr_1fr]">
            <pre className="overflow-auto rounded-2xl bg-neutral-900 p-5 text-sm leading-relaxed text-neutral-100">
              <code>{`# 1. Install the CLI
npm i -g @markbase/cli

# 2. Connect your account (opens the browser)
markbase login        # verifies your key, then installs
                    # + starts the background service

# everyday:
markbase doctor              # check prerequisites
markbase install-service     # start it in the background`}</code>
            </pre>
            <ol className="space-y-5 text-sm" style={{ color: MUTED }}>
              <Step n={1} title="It logs in as you">
                <code className="font-mono">markbase login</code> resolves your
                account from an API key, so the worker only claims your jobs.
              </Step>
              <Step n={2} title="It runs as a service">
                Registered with launchd or systemd. Starts at login, restarts on
                crash, writes logs you can tail.
              </Step>
              <Step n={3} title="It polls quietly">
                Every few seconds it asks for your next ticket. Real work only
                happens while one runs.
              </Step>
            </ol>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className={`border-t ${DIVIDER} px-6 py-24 md:py-32`}
        style={{ background: SURFACE }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold leading-tight tracking-tight md:text-5xl">
            Run the whole business from your pocket.
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base md:text-lg" style={{ color: MUTED }}>
            Spin up a project, share the request link, and handle code and
            clients from your phone.
          </p>
          <div className="mt-9 flex justify-center">
            <Link href="/login" className={accentBtn}>
              Open your dashboard <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <SiteFooter />
    </div>
  );
}

function Feature({
  Icon,
  title,
  body,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex size-10 items-center justify-center rounded-xl bg-[#e5ff6e]">
        <Icon className="size-5 text-neutral-900" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: MUTED }}>
        {body}
      </p>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-neutral-900" />
      <span>{children}</span>
    </li>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-white">
        {n}
      </span>
      <span>
        <span className="font-semibold text-neutral-900">{title}.</span>{" "}
        {children}
      </span>
    </li>
  );
}
