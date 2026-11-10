import Link from "next/link";
import Image from "next/image";
import { SiteHeader, SITE_PRIMARY_BTN } from "@/components/site-header";
import {
  Apple,
  ArrowRight,
  Bot,
  Briefcase,
  Check,
  ClipboardList,
  Code2,
  FileText,
  GitBranch,
  Globe,
  History,
  MessagesSquare,
  PenTool,
  ShieldCheck,
  Users,
} from "lucide-react";
import { StayInTouchForm } from "@/components/stay-in-touch";

import { MAC_DOWNLOAD_URL } from "@markbase/protocol/downloads";

// Canonical destinations, reused in the nav, footer, and the SiteNavigationElement
// structured data that hints Google's sitelinks.
const OVERVIEW_DOC_HREF = "/p/overview-5ac13a99";
const STAY_IN_TOUCH_HREF = "/#stay-in-touch";
const SITE_URL = "https://markbase.so";

// Organization + WebSite + SiteNavigationElement for rich results: the logo
// Google shows next to the result, and the "Overview doc" / "Stay in touch"
// sitelink hints.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Markbase",
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/logo.png`,
        width: 1024,
        height: 1024,
      },
      description: "The AI-native markdown humans and agents write together.",
      // Add real owned profiles (X, GitHub, LinkedIn, Product Hunt) here to
      // help search + AI models disambiguate the "Markbase" entity.
      sameAs: [],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Markbase",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#app`,
      name: "Markbase",
      url: SITE_URL,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Collaborative document editor",
      operatingSystem: "Web",
      description:
        "The AI-native markdown humans and agents write together — a shared workspace where you and the agents you already use read, write, comment on, and publish the same living documents, with full version history and one source of truth.",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SiteNavigationElement",
      name: "Docs",
      url: `${SITE_URL}${OVERVIEW_DOC_HREF}`,
    },
    {
      "@type": "SiteNavigationElement",
      name: "Stay in touch",
      url: `${SITE_URL}${STAY_IN_TOUCH_HREF}`,
    },
  ],
};

const primaryBtn = SITE_PRIMARY_BTN;
const secondaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 px-5 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50";

const INTEGRATIONS = ["Claude", "Cursor", "Codex", "opencode", "Pi", "OpenClaw"];

// One product, four buyers. Each card is written in that person's language —
// the thing they are measured on, not the feature list — because the same
// page has to close the engineering lead who signs, the PM who champions, the
// designer who has to live in it, and the agency owner buying it for clients.
const AUDIENCES = [
  {
    icon: Code2,
    role: "Engineering leads",
    title: "The spec your agent reads is the one the PM edited this morning",
    body: "Documents live as markdown in the repo. The agents your team already runs read and write them over MCP, so nobody re-explains context in a chat window.",
    points: ["Specs, decisions, and runbooks next to the code", "Agents edit in place — structure preserved, every change recorded", "One source of truth across people, agents, and tools"],
  },
  {
    icon: ClipboardList,
    role: "Product managers",
    title: "Write it once, in a doc, and watch it turn into work",
    body: "Requirements and decisions stay in one living document. Agents raise questions as comments on the exact line and build from the agreed spec.",
    points: ["No surprises: the doc your engineers build from is the one you wrote", "Comments anchored to the text, resolved when settled", "Progress visible where the spec is, not in a status meeting"],
  },
  {
    icon: PenTool,
    role: "Designers",
    title: "Handoff notes that sit next to the code",
    body: "States, rationale, and edge cases live beside the spec the agent builds from, so what ships matches what you drew — and your notes are read, not lost in a thread.",
    points: ["Design intent in the same document as the requirements", "Agents see your notes when they implement", "Review the result in place, on the current version"],
  },
  {
    icon: Briefcase,
    role: "Agency owners",
    title: "A living spec your clients can watch",
    body: "Share a document with a client as view-only. Progress lands in it as the work does, under your name — fewer status updates to write, and a client who can see the value.",
    points: ["Viewer links for clients, editor rights for your team", "Updates arrive as agents and engineers finish the work", "Run it on your own infrastructure if you need to"],
  },
];

const AI_NATIVE = [
  {
    icon: Bot,
    title: "Agents edit, not rewrite",
    body: "Connect an agent and it makes precise, quote-and-replace edits to the passage you name — your structure and formatting preserved, not regenerated.",
  },
  {
    icon: MessagesSquare,
    title: "Review in shared comments",
    body: "Agents leave comments anchored to the exact text — raising questions, flagging blockers — and resolve them once settled. Humans keep authority over the content.",
  },
  {
    icon: GitBranch,
    title: "One source of truth",
    body: "Plain markdown, every change recorded. People and agents work the same document, so nothing drifts out of sync across chats and threads.",
  },
];

const USE_CASES = [
  {
    icon: Users,
    title: "Team collaboration",
    body: "Proposals, specs, and decisions authored by people and agents in one place — instead of context pasted between tools.",
  },
  {
    icon: FileText,
    title: "Stakeholder communication",
    body: "A shared surface between contributors and customers. Write once, comment in place, always on the current version.",
  },
  {
    icon: Globe,
    title: "GEO & SEO content",
    body: "Draft with your agents, then publish a clean, crawlable page — built for search engines and AI answers alike.",
  },
];

const STEPS = [
  { n: "01", title: "Create a document", body: "Sign in and write in a markdown editor with slash commands, tables, and version history." },
  { n: "02", title: "Connect your agent", body: "One command wires up Claude Code and Claude Desktop over MCP.", code: "npx @markbase/cli mcp install" },
  { n: "03", title: "Work it together", body: "Ask your agent to read, edit, and comment — on the same document your team is in." },
  { n: "04", title: "Publish", body: "Turn any document into a public, SEO- and GEO-ready page in a click." },
];

const FOUNDATIONS = [
  { icon: FileText, title: "Own your content", body: "Plain markdown, versioned. Export anytime — no proprietary lock-in." },
  { icon: ShieldCheck, title: "Granular access", body: "Per-person and per-agent roles — owner, editor, commenter, viewer. Cap exactly what an agent can do." },
  { icon: History, title: "Full history", body: "Every change is recorded, with one-click rollback to any prior version." },
  { icon: Globe, title: "Built to publish", body: "Server-rendered pages with structured metadata, ready for Google and AI answers." },
];

export function MarkbaseLanding() {
  return (
    <div className="min-h-svh bg-white text-zinc-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <SiteHeader />

      {/* Hero */}
      <section className="px-6 pt-24 pb-16 md:pt-32">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600">
            <span className="size-1.5 rounded-full bg-[#c7e600]" /> Documentation for the AI era
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-zinc-900 md:text-6xl md:leading-[1.05]">
            The AI-native markdown humans and agents write together
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-600">
            Read, write, review, and publish the same document — with the agents you already use.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className={primaryBtn}>
              Get started <ArrowRight className="size-4" />
            </Link>
            <Link href="/p/overview-5ac13a99" className={secondaryBtn}>
              See a live document
            </Link>
          </div>
          <MacDownload />
        </div>

        {/* Browser-framed product screenshot */}
        <div className="mx-auto mt-16 max-w-5xl px-0">
          <div className="overflow-hidden rounded-xl border border-zinc-200 shadow-[0_24px_60px_-24px_rgba(24,24,27,0.28)]">
            <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5">
              <span className="size-3 rounded-full bg-zinc-200" />
              <span className="size-3 rounded-full bg-zinc-200" />
              <span className="size-3 rounded-full bg-zinc-200" />
              <span className="ml-3 rounded border border-zinc-100 bg-white px-2.5 py-0.5 text-xs text-zinc-400">
                markbase.so
              </span>
            </div>
            <Image
              src="/welcome-doc.png"
              alt="A Markbase document with AI agent comments anchored to the text"
              width={1440}
              height={900}
              className="w-full"
              priority
            />
          </div>
        </div>
      </section>

      {/* Integrations trust bar */}
      <section className="border-y border-zinc-100 bg-zinc-50/60 px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <p className="text-center text-xs font-medium tracking-wide text-zinc-400 uppercase">
            Works with the agents your team already uses
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {INTEGRATIONS.map((name, i) => (
              <span
                key={name}
                className="text-base font-semibold text-zinc-500"
                title={i === 0 ? "Available now" : "Coming soon"}
              >
                {name}
                {i > 0 && <span className="ml-1 align-super text-[10px] font-normal text-zinc-300">soon</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for — one card per buyer, in their own terms */}
      <Section
        title="Built for the whole product team"
        lead="Engineers, product, design, and the agencies that serve clients work the same document — each gets the part they are measured on."
      >
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCES.map((a) => (
            <AudienceCard key={a.role} {...a} />
          ))}
        </div>
      </Section>

      {/* What makes it AI-native */}
      <Section title="What makes it AI-native" lead="An agent is a first-class collaborator on the document itself — not a chat box on the side.">
        <div className="grid gap-6 md:grid-cols-3">
          {AI_NATIVE.map((c) => (
            <Card key={c.title} icon={c.icon} title={c.title} body={c.body} />
          ))}
        </div>
      </Section>

      {/* Use cases */}
      <div className="bg-zinc-50/60">
        <Section title="Where teams use it" lead="From first draft to published page — with people and agents on the same document.">
          <div className="grid gap-6 md:grid-cols-3">
            {USE_CASES.map((c) => (
              <Card key={c.title} icon={c.icon} title={c.title} body={c.body} white />
            ))}
          </div>
        </Section>
      </div>

      {/* How it works */}
      <Section title="How it works">
        <div className="grid gap-x-8 gap-y-10 md:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n}>
              <div className="text-sm font-semibold text-zinc-300">{s.n}</div>
              <h3 className="mt-3 text-base font-semibold text-zinc-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{s.body}</p>
              {s.code && (
                <code className="mt-3 block overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs text-zinc-100">
                  {s.code}
                </code>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* Enterprise foundations */}
      <div className="border-y border-zinc-100 bg-zinc-50/60">
        <Section title="Built on solid foundations" lead="The controls teams need to adopt AI in their documentation with confidence.">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FOUNDATIONS.map((f) => (
              <Card key={f.title} icon={f.icon} title={f.title} body={f.body} white />
            ))}
          </div>
        </Section>
      </div>

      {/* CTA */}
      <section className="bg-zinc-900 px-6 py-24 text-center md:py-32">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Bring your team and its agents into one document
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-zinc-400">
            Free to start. Works with the agent you already use.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/login" className="inline-flex items-center gap-2 rounded-lg bg-[#e5ff6e] px-5 py-2.5 text-sm font-semibold text-zinc-900 transition hover:brightness-95">
              Get started <ArrowRight className="size-4" />
            </Link>
            {/* The other half of "bring your team in": the desktop app is what
                turns a vault into a folder of files on your machine. */}
            <a
              href={MAC_DOWNLOAD_URL}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-100 transition hover:bg-zinc-800"
            >
              <Apple className="size-4" />
              Download for Mac
            </a>
          </div>
        </div>
      </section>

      {/* Stay in touch — email capture (sitelink anchor target) */}
      <section id="stay-in-touch" className="scroll-mt-20 border-t border-zinc-100 px-6 py-20 md:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">
            Stay in touch
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-zinc-600">
            Leave your email for product updates and early access. No spam — just
            the occasional note when something ships.
          </p>
          <div className="mt-8">
            <StayInTouchForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100 px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1.5fr]">
            <div>
              <div className="flex items-center gap-2">
                <Image src="/logo.png" alt="" width={24} height={24} className="size-6 object-contain" />
                <span className="text-base font-semibold">Markbase</span>
              </div>
              <p className="mt-3 max-w-xs text-sm text-zinc-500">
                The documentation layer for humans and AI agents.
              </p>
            </div>
            <FooterCol
              title="Product"
              links={[
                ["Docs", "/docs"],
                ["See a live doc", "/p/overview-5ac13a99"],
                ["Download for Mac", MAC_DOWNLOAD_URL],
                ["Releases", "/releases"],
                ["Sign in", "/login"],
                ["Get started", "/login"],
              ]}
            />
            <FooterCol title="Company" links={[["Privacy", "/privacy-policy"], ["Terms", "/terms"]]} />
            <div>
              <div className="text-sm font-semibold text-zinc-900">Stay in touch</div>
              <p className="mt-2 max-w-xs text-sm text-zinc-500">
                Get product updates and early access.
              </p>
              <Link href={STAY_IN_TOUCH_HREF} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-zinc-900 hover:underline">
                Join the list <ArrowRight className="size-3.5" />
              </Link>
              <a href="mailto:hello@markbase.so" className="mt-3 block text-sm text-zinc-500 hover:text-zinc-900">
                hello@markbase.so
              </a>
            </div>
          </div>
          <div className="mt-12 border-t border-zinc-100 pt-6 text-sm text-zinc-400">
            © {new Date().getFullYear()} Markbase. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-6 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-zinc-900 md:text-4xl">{title}</h2>
        {lead && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-zinc-600">{lead}</p>}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function Card({
  icon: Icon,
  title,
  body,
  white,
}: {
  icon: typeof Bot;
  title: string;
  body: string;
  white?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-zinc-200 p-6 ${white ? "bg-white" : ""}`}>
      <div className="grid size-10 place-items-center rounded-lg bg-zinc-100">
        <Icon className="size-5 text-zinc-700" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-zinc-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{body}</p>
    </div>
  );
}

/**
 * An audience callout: who it is for, the one promise in their words, and the
 * three things they get. The lime icon tile is the page's accent, used here
 * because this is the section that has to catch a specific reader's eye.
 */
function AudienceCard({
  icon: Icon,
  role,
  title,
  body,
  points,
}: {
  icon: typeof Bot;
  role: string;
  title: string;
  body: string;
  points: string[];
}) {
  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 p-6">
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#e5ff6e]">
          <Icon className="size-5 text-zinc-900" />
        </div>
        <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{role}</div>
      </div>
      <h3 className="mt-4 text-base font-semibold leading-snug text-zinc-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{body}</p>
      <ul className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2 text-sm leading-relaxed text-zinc-700">
            <Check className="mt-1 size-3.5 shrink-0 text-zinc-900" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-sm font-semibold text-zinc-900">{title}</div>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="text-sm text-zinc-500 transition hover:text-zinc-900">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Download for Mac", when there is a build to download.
 *
 * Points at the `releases/latest/download/…` permalink, which GitHub resolves to
 * the newest release — so publishing a build (apps/app/scripts/publish-dmg.sh)
 * needs no change here and nothing already linking to it goes stale.
 *
 * The app is not notarised, so macOS will refuse it on a double-click. Saying so
 * under the button costs one line and saves the support message — a download
 * that appears broken is worse than one that warned you.
 */
function MacDownload() {
  // Defaults to the public permalink, so a deploy needs no environment change to
  // offer the current build. GitHub resolves `latest/download/<name>` to the
  // newest release, which is why the asset name carries no version — publishing
  // a new one strands nothing that already links here. The env var stays as an
  // override for pointing a preview at some other build.
  const href = process.env.NEXT_PUBLIC_MAC_DOWNLOAD_URL ?? MAC_DOWNLOAD_URL;
  if (!href) return null;
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      {/* A button, not a text link. Creating a vault needs the desktop app — the
          browser can read and edit documents but cannot put them in a folder on
          your machine — so this is a way in, not a footnote. */}
      <a href={href} className={secondaryBtn}>
        <Apple className="size-4" />
        Download for Mac
        <span className="font-normal text-zinc-400">· Apple silicon</span>
      </a>
      <p className="text-xs text-zinc-500">
        Unsigned build — right-click the app and choose Open the first time.
      </p>
    </div>
  );
}
