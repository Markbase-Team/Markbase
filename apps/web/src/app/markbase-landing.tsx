import Link from "next/link";
import Image from "next/image";
import { Fragment_Mono, Geist, Manrope } from "next/font/google";
import {
  Apple,
  ArrowRight,
  Box,
  Check,
  GitFork,
  Globe,
  History,
  MessageCircleQuestion,
  MessageSquare,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import { StayInTouchForm } from "@/components/stay-in-touch";

import { MAC_DOWNLOAD_URL, MAC_FIRST_OPEN_NOTE, REPO_URL } from "@markbase/protocol/downloads";
import { latestMacVersion } from "@/lib/latest-release";

// Canonical destinations, reused in the nav, footer, and the SiteNavigationElement
// structured data that hints Google's sitelinks.
const DOCS_HREF = "/docs";
const STAY_IN_TOUCH_HREF = "/#stay-in-touch";
const SITE_URL = "https://markbase.so";
const ORG_URL = "https://github.com/Markbase-Team";
const NPM_CLI_URL = "https://www.npmjs.com/package/@markbase/cli";

// The landing's own type, scoped to this page so the app keeps DM Sans:
// Manrope for display and card titles, Geist for everything else, Fragment
// Mono for commands. All three are Google fonts, loaded the same way as the
// app's brand font in layout.tsx.
const display = Manrope({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-landing-display" });
const body = Geist({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-landing-sans" });
const mono = Fragment_Mono({ subsets: ["latin"], weight: "400", variable: "--font-landing-mono" });

const DISPLAY = "font-[family-name:var(--font-landing-display)]";
const MONO = "font-[family-name:var(--font-landing-mono)]";

// Organization + WebSite + SoftwareApplication + SiteNavigationElement for rich
// results: the logo Google shows next to the result, the app's facts, and the
// "Docs" / "Stay in touch" sitelink hints. Built per request for the version.
const structuredData = (version: string | null) => ({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Markbase",
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/markbase-logo.png`,
        width: 1024,
        height: 1024,
      },
      description: "One markdown folder for your team and its agents.",
      // Profiles we own, so search and AI models can tell this "Markbase" apart
      // from the other projects that share the name.
      sameAs: [REPO_URL, ORG_URL, NPM_CLI_URL],
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
      operatingSystem: "Web, macOS",
      description:
        "One markdown folder for your team and its agents: plain markdown files that sync between a folder on your machine and the cloud, edited by people in a WYSIWYG editor and by agents like Claude Code, Codex and Cursor on disk, with version history, comments and sharing.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      downloadUrl: MAC_DOWNLOAD_URL,
      ...(version ? { softwareVersion: version } : {}),
      license: "https://www.apache.org/licenses/LICENSE-2.0",
      codeRepository: REPO_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SiteNavigationElement",
      name: "Docs",
      url: `${SITE_URL}${DOCS_HREF}`,
    },
    {
      "@type": "SiteNavigationElement",
      name: "Stay in touch",
      url: `${SITE_URL}${STAY_IN_TOUCH_HREF}`,
    },
  ],
});

// Zova-style pill buttons: ink for the primary action, white with a hairline
// for the secondary one. The brand lime stays on marks, tags and badges, where
// a highlight reads as a highlight rather than as a second button colour.
const inkBtn =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800";
const ghostBtn =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50";

// "Available now" first; the rest are marked soon.
const AGENTS: { name: string; live?: boolean }[] = [
  { name: "Claude Code", live: true },
  { name: "Claude Desktop", live: true },
  { name: "Cursor" },
  { name: "Codex" },
  { name: "opencode" },
  { name: "Pi" },
  { name: "OpenClaw" },
];

// Four things that are true of every document, said once, with dividers between
// them the way a product spec sheet does it.
const FEATURES = [
  {
    icon: PenLine,
    title: "Agents edit, not rewrite",
    body: "Quote-and-replace edits to the passage you name. Your structure stays yours.",
  },
  {
    icon: MessageSquare,
    title: "Comments on the line",
    body: "Questions and blockers anchor to the exact text and resolve once settled.",
  },
  {
    icon: History,
    title: "Every change versioned",
    body: "Human or agent, each save is a version you can compare and roll back.",
  },
  {
    icon: Globe,
    title: "Publish in a click",
    body: "Any document becomes a clean page, ready for search engines and AI answers.",
  },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Where do my documents live?",
    a: "As plain markdown files in a folder on your Mac, kept in sync with a shared copy in the cloud. You can grep them, commit them and export them at any time.",
  },
  {
    q: "Which agents can work on them?",
    a: "Claude Code and Claude Desktop today, over MCP, with one install command. Cursor, Codex, opencode, Pi and OpenClaw are coming.",
  },
  {
    q: "Can an agent rewrite my whole document?",
    a: "No. Agents edit by quoting the passage they want to change and replacing exactly that, and every save is a version you can roll back.",
  },
  {
    q: "How do I control what an agent can do?",
    a: "Each person and each agent gets a role on a document: owner, editor, commenter or viewer. A commenter can raise questions but never change the text.",
  },
  {
    q: "Can I share a document with someone outside my team?",
    a: "Yes. Share it with a person by role, or publish it as a public page with clean, server-rendered HTML.",
  },
  {
    q: "Is it open source?",
    a: "Yes. The code is on GitHub under Markbase-Team, and it can be self-hosted as a single Docker image on a Supabase project you own.",
  },
];

const FOOTER_PRODUCT: [string, string][] = [
  ["Product", "/#why"],
  ["Docs", DOCS_HREF],
  ["Releases", "/releases"],
  ["Blog", "/blog"],
];

const FOOTER_COMPANY: [string, string][] = [
  ["GitHub", REPO_URL],
  ["Contact", "mailto:hello@markbase.so"],
  ["Privacy", "/privacy-policy"],
  ["Terms", "/terms"],
];

export async function MarkbaseLanding() {
  const version = await latestMacVersion();
  return (
    <div
      className={`${display.variable} ${body.variable} ${mono.variable} min-h-svh bg-white font-[family-name:var(--font-landing-sans)] text-zinc-900 [letter-spacing:-0.02em]`}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(version)) }}
      />

      <LandingNav />

      {/* Hero: headline left, the idea on the right, the product below, on a
          wash of the brand lime that the next section sits on top of. */}
      <section
        id="top"
        className="scroll-mt-24 bg-[linear-gradient(180deg,#ffffff_0%,#ffffff_45%,#f6ffd6_100%)] px-6 pt-16 md:pt-20"
      >
        <div className="mx-auto max-w-6xl">
          <div className="grid items-end gap-10 lg:grid-cols-12 lg:gap-8">
            <div className="flex flex-col items-start gap-6 lg:col-span-7">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600">
                <span className="size-1.5 rounded-full bg-[#a3d100]" /> Open source · free to use
              </span>
              <h1
                className={`${DISPLAY} max-w-2xl text-4xl font-semibold leading-[1.06] tracking-[-0.05em] text-balance md:text-6xl`}
              >
                Your agents work in the same document your team does
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/login" className={inkBtn}>
                  Get started <ArrowRight className="size-4" />
                </Link>
                <a href={REPO_URL} className={ghostBtn}>
                  <GitFork className="size-4" /> View on GitHub
                </a>
              </div>
            </div>
            <div className="flex flex-col items-start gap-4 lg:col-span-5">
              <DocWithComment />
              <p className="mt-6 max-w-sm text-sm leading-relaxed text-zinc-600">
                One markdown folder for people and agents. Claude, Cursor or Codex read it, edit the exact
                passage you name, and comment on the line. Every change is a version.
              </p>
              <span className="inline-flex items-center gap-2 text-sm text-zinc-600">
                <Check className="size-3.5 text-zinc-900" /> Open source under Markbase-Team on GitHub
              </span>
            </div>
          </div>

          {/* Browser-framed product screenshot, rising out of the gradient */}
          <div className="mt-14 flex justify-center">
            <div className="w-full max-w-5xl overflow-hidden rounded-t-2xl border border-b-0 border-zinc-200 bg-white shadow-[0_30px_70px_-40px_rgba(24,24,27,0.35)]">
              <BrowserBar />
              <Image
                src="/welcome-doc.png"
                alt="A Markbase document with AI agent comments anchored to the text"
                width={1440}
                height={900}
                priority
                className="h-auto w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Four features, divided like a spec sheet */}
      <section className="border-t border-zinc-100 px-6 py-16 md:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
            {FEATURES.map(({ icon: Icon, title, body: text }, i) => (
              <div
                key={title}
                className={`flex flex-col gap-3 ${i > 0 ? "lg:border-l lg:border-zinc-200 lg:pl-7" : ""} ${i < FEATURES.length - 1 ? "lg:pr-7" : ""}`}
              >
                <Icon className="size-5 text-zinc-900" />
                <h2 className={`${DISPLAY} text-[17px] font-semibold tracking-[-0.04em]`}>{title}</h2>
                <p className="text-sm leading-relaxed text-zinc-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why: a list of reasons on the left, one panel each on the right */}
      <section id="why" className="scroll-mt-24 px-6 pt-8 pb-24 md:pb-28">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="flex flex-col gap-5 lg:col-span-4">
              <h2 className={`${DISPLAY} text-3xl font-semibold leading-[1.1] tracking-[-0.05em] md:text-[40px]`}>
                Why teams put their <mark className="rounded-md bg-[#e5ff6e] px-1.5">agents</mark> in Markbase
              </h2>
              <p className="max-w-xs text-[15px] leading-relaxed text-zinc-600">
                A plain folder on disk, a shared document in the cloud, and the agents you already use, all working
                on the same text.
              </p>
              <nav aria-label="Reasons" className="mt-2 flex flex-col gap-1.5">
                <ReasonLink href="#panel-truth" icon={Box} label="One source of truth" active />
                <ReasonLink href="#panel-edits" icon={PenLine} label="Precise edits" />
                <ReasonLink href="#panel-control" icon={ShieldCheck} label="You stay in control" />
              </nav>
            </div>
            <div className="flex flex-col gap-6 lg:col-span-8">
              <Panel
                id="panel-truth"
                title="One source of truth"
                lead="People and agents work the same file, so nothing drifts between chats, threads and docs. The desktop app keeps it as a folder on your Mac; the web keeps it shared."
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <MiniCard label="On disk">
                    <pre className={`${MONO} text-xs leading-relaxed whitespace-pre-line text-zinc-700`}>
                      {"~/Markbase/vault/\n  launch-plan.md\n  specs/api.md\n  decisions/2026-11.md"}
                    </pre>
                  </MiniCard>
                  <MiniCard label="In the cloud">
                    <p className="text-[13px] leading-relaxed text-zinc-700">
                      launch-plan · shared with 4<br />
                      specs/api · 2 open comments
                      <br />
                      decisions/2026-11 · published
                    </p>
                  </MiniCard>
                  <MiniCard label="In your agent" dark>
                    <pre className={`${MONO} text-xs leading-relaxed whitespace-pre-line text-[#e5ff6e]`}>
                      {"› read launch-plan.md\n› tighten the intro\n› comment on §2"}
                    </pre>
                  </MiniCard>
                </div>
              </Panel>
              <Panel
                id="panel-edits"
                title="Precise edits"
                lead="An agent names the passage it wants to change and replaces exactly that. No regenerated document, no lost formatting."
              >
                <div className="flex max-w-xl flex-col gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-4 text-[13px] leading-relaxed">
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">
                    Edit by quote
                  </span>
                  <span className="text-zinc-600">
                    <span className="text-zinc-400 line-through">
                      The onboarding email goes out the morning after sign-up
                    </span>{" "}
                    → <mark className="rounded-sm bg-[#f1ffb3]">The onboarding email goes out within 12 hours of sign-up</mark>
                  </span>
                  <span className="text-zinc-600">
                    Saved as v15 by <span className="font-semibold text-zinc-900">Claude</span> · 1 line changed
                  </span>
                </div>
              </Panel>
              <Panel
                id="panel-control"
                title="You stay in control"
                lead="Per-person and per-agent roles: owner, editor, commenter, viewer. Cap what an agent can do, and roll back any version with one click."
              >
                <div className="flex flex-wrap gap-2.5">
                  <RolePill dot="bg-zinc-900" label="Jessie · owner" />
                  <RolePill dot="bg-[#a3d100]" label="Claude · commenter" />
                  <RolePill dot="bg-zinc-400" label="Client · viewer" />
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </section>

      {/* Three steps */}
      <section id="how" className="scroll-mt-24 border-y border-zinc-100 bg-zinc-50 px-6 py-20 md:py-24">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-11">
          <div className="flex max-w-xl flex-col items-center gap-3 text-center">
            <h2 className={`${DISPLAY} text-3xl font-semibold leading-[1.1] tracking-[-0.05em] md:text-[40px]`}>
              Get started in 3 steps
            </h2>
            <p className="text-base leading-relaxed text-zinc-600">
              From a blank folder to a shared document your agent can work on, in a few minutes.
            </p>
          </div>
          <div className="grid w-full gap-6 md:grid-cols-3">
            <Step
              n="01"
              title="Write a document"
              body="Sign in and write in a markdown editor, or mount a folder you already have on your Mac."
            >
              <div className="flex flex-col gap-2">
                <Eyebrow>New document</Eyebrow>
                <span className={`${DISPLAY} text-lg font-semibold tracking-[-0.04em]`}>Launch plan · Q1</span>
                <span className="h-2 w-4/5 rounded bg-zinc-100" />
                <span className="h-2 w-11/12 rounded bg-zinc-100" />
                <span className="h-2 w-3/5 rounded bg-zinc-100" />
                <span className="mt-1 text-xs text-zinc-400">Type / for headings, tables, lists</span>
              </div>
            </Step>
            <Step
              n="02"
              title="Connect your agent"
              body="One command wires up Claude Code and Claude Desktop over MCP."
              dark
            >
              <div className="flex flex-col gap-2">
                <Eyebrow>Terminal</Eyebrow>
                <pre className={`${MONO} text-[13px] leading-[1.8] whitespace-pre-line text-[#e5ff6e]`}>
                  {"$ npx @markbase/cli mcp install\n✓ Claude Code connected\n✓ Claude Desktop connected"}
                </pre>
              </div>
            </Step>
            <Step
              n="03"
              title="Work it together"
              body="Ask your agent to read, edit and comment, then publish the page when it is ready."
            >
              <div className="flex flex-col gap-2">
                <Eyebrow>Comments</Eyebrow>
                <CommentCard who="Claude" agent text="Should §2 mention the pilot pricing?" />
                <CommentCard who="Jessie" text="Yes, add one line. Then publish." />
              </div>
            </Step>
          </div>
        </div>
      </section>

      {/* Agents */}
      <section className="px-6 py-20 md:py-24">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-10">
          <div className="flex max-w-xl flex-col items-center gap-3 text-center">
            <h2 className={`${DISPLAY} text-3xl font-semibold leading-[1.1] tracking-[-0.05em] md:text-[40px]`}>
              Works with the agents you already use
            </h2>
            <p className="text-base leading-relaxed text-zinc-600">
              Markbase speaks MCP, so the tools your team runs today read and write the same folder.
            </p>
          </div>
          <ul className="flex max-w-3xl flex-wrap justify-center gap-3">
            {AGENTS.map(({ name, live }) => (
              <li
                key={name}
                className={`inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-[15px] font-semibold ${live ? "text-zinc-900" : "text-zinc-500"}`}
              >
                {live && <span className="size-2 rounded-full bg-[#a3d100]" />}
                {name}
                {!live && (
                  <span className="text-[10px] font-semibold tracking-[0.06em] text-zinc-400 uppercase">soon</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-24 border-t border-zinc-100 px-6 py-20 md:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="flex flex-col items-start gap-4 lg:col-span-4">
              <h2 className={`${DISPLAY} text-3xl font-semibold leading-[1.1] tracking-[-0.05em] md:text-[40px]`}>
                Help and support
              </h2>
              <p className="max-w-xs text-[15px] leading-relaxed text-zinc-600">
                Answers to the questions teams ask before they let an agent near their docs.
              </p>
              <div className="grid h-36 w-full max-w-xs place-items-center rounded-2xl bg-[#f6ffd6]">
                <MessageCircleQuestion className="size-16 text-zinc-900" strokeWidth={1.5} />
              </div>
              <span className="mt-1 text-sm text-zinc-600">Still got questions?</span>
              <a href="mailto:hello@markbase.so" className={inkBtn}>
                Contact us
              </a>
            </div>
            <div className="flex flex-col gap-2.5 lg:col-span-8">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group rounded-2xl border border-zinc-200 px-5 py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
                    {q}
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-zinc-900 text-white transition group-open:rotate-45">
                      <ArrowRight className="size-3.5 -rotate-45" />
                    </span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-zinc-600">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Closing call to action, the product peeking in from below */}
      <section className="overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#f6ffd6_100%)] px-6 pt-20 md:pt-24">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-12">
          <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
            <h2 className={`${DISPLAY} text-3xl font-semibold leading-[1.08] tracking-[-0.05em] text-balance md:text-[44px]`}>
              Bring your team and its agents into one document
            </h2>
            <p className="text-base leading-relaxed text-zinc-600">
              Free to start. Works with the agent you already use.
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-3">
              <Link href="/login" className={inkBtn}>
                Get started <ArrowRight className="size-4" />
              </Link>
              <MacDownload version={version} />
            </div>
            {MAC_FIRST_OPEN_NOTE && (
              <p className="max-w-sm text-center text-xs text-zinc-500">{MAC_FIRST_OPEN_NOTE}</p>
            )}
          </div>
          <div className="w-full max-w-4xl overflow-hidden rounded-t-2xl border border-b-0 border-zinc-200 bg-white shadow-[0_30px_70px_-40px_rgba(24,24,27,0.35)]">
            <Image
              src="/welcome-doc.png"
              alt=""
              width={1440}
              height={900}
              className="h-56 w-full object-cover object-top"
            />
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

/**
 * The landing's floating pill nav. Other public pages keep SiteHeader; this page
 * follows the Zova layout, where the bar floats over the hero as one rounded
 * strip with the brand, a few anchors and the one button that matters.
 */
function LandingNav() {
  return (
    <div className="sticky top-4 z-20 flex justify-center px-4">
      <nav
        aria-label="Primary"
        className="flex items-center gap-5 rounded-full border border-zinc-200 bg-white/90 py-2 pr-2 pl-3.5 shadow-[0_10px_30px_-18px_rgba(24,24,27,0.35)] backdrop-blur"
      >
        <Link href="/" className="flex items-center gap-2">
          <Image src="/markbase-logo.png" alt="Markbase" width={26} height={26} className="size-6 object-contain" />
          <span className="hidden text-sm font-semibold sm:inline">Markbase</span>
        </Link>
        <div className="hidden items-center gap-5 pr-1 text-sm font-medium text-zinc-600 md:flex">
          <a href="#why" className="transition hover:text-zinc-900">
            Product
          </a>
          <a href="#how" className="transition hover:text-zinc-900">
            How it works
          </a>
          <a href="#faq" className="transition hover:text-zinc-900">
            FAQ
          </a>
          <Link href={DOCS_HREF} className="transition hover:text-zinc-900">
            Docs
          </Link>
          <a href={REPO_URL} className="transition hover:text-zinc-900">
            GitHub
          </a>
        </div>
        <Link href="/login" className={`${inkBtn} h-9 px-4`}>
          Get started <ArrowRight className="size-3.5" />
        </Link>
      </nav>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-zinc-100 px-6 pt-14 pb-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <div className="grid gap-8 md:grid-cols-12">
          <div id="stay-in-touch" className="flex scroll-mt-24 flex-col items-start gap-4 md:col-span-6">
            <Image src="/markbase-logo.png" alt="" width={30} height={30} className="size-7 object-contain" />
            <span className={`${DISPLAY} text-base font-semibold tracking-[-0.03em]`}>Stay connected</span>
            <p className="max-w-sm text-sm text-zinc-600">
              Product updates and early access. No spam, just a note when something ships.
            </p>
            <div className="w-full max-w-sm">
              <StayInTouchForm />
            </div>
          </div>
          <FooterCol title="Product" links={FOOTER_PRODUCT} />
          <FooterCol title="Company" links={FOOTER_COMPANY} />
          <FooterCol
            title="More"
            links={[
              ["Sign in", "/login"],
              ["Mac app", MAC_DOWNLOAD_URL],
            ]}
          />
        </div>
        <div className="flex flex-wrap justify-between gap-3 border-t border-zinc-100 pt-5 text-sm text-zinc-500">
          <span>© {new Date().getFullYear()} Markbase. All rights reserved.</span>
          <a href="mailto:hello@markbase.so" className="hover:text-zinc-900">
            hello@markbase.so
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="flex flex-col gap-2.5 md:col-span-2">
      <span className="text-xs font-semibold tracking-[0.08em] text-zinc-400 uppercase">{title}</span>
      {links.map(([label, href]) =>
        href.startsWith("/") ? (
          <Link key={label} href={href} className="text-sm text-zinc-600 transition hover:text-zinc-900">
            {label}
          </Link>
        ) : (
          <a key={label} href={href} className="text-sm text-zinc-600 transition hover:text-zinc-900">
            {label}
          </a>
        )
      )}
    </div>
  );
}

/** The hero illustration: a document with an agent's comment anchored to one passage. */
function DocWithComment() {
  return (
    <div className="relative w-full max-w-md">
      <div className="flex flex-col gap-2.5 rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(24,24,27,0.05)]">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="font-semibold text-zinc-700">launch-plan.md</span>
          <span>· synced v14</span>
        </div>
        <span className={`${DISPLAY} text-base font-semibold tracking-[-0.03em]`}>Launch plan · Q1</span>
        <p className="text-[13px] leading-relaxed text-zinc-600">
          Ship the desktop app to the first fifty teams.{" "}
          <mark className="rounded-sm bg-[#f1ffb3] shadow-[0_0_0_2px_#f1ffb3]">
            The onboarding email goes out the morning after sign-up
          </mark>
          , with the install command and one example document.
        </p>
      </div>
      <div className="absolute -right-2 -bottom-8 flex w-60 flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 shadow-[0_12px_32px_-16px_rgba(24,24,27,0.35)] sm:-right-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold">Claude</span>
          <span className="rounded bg-[#e5ff6e] px-1.5 py-px text-[10px] font-semibold">agent</span>
          <span className="ml-auto text-zinc-400">just now</span>
        </div>
        <p className="text-xs leading-relaxed text-zinc-700">
          “The morning after” is ambiguous across time zones. Change it to “within 12 hours of sign-up”?
        </p>
      </div>
    </div>
  );
}

function BrowserBar() {
  return (
    <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-3.5 py-2.5">
      <span className="size-2.5 rounded-full bg-zinc-200" />
      <span className="size-2.5 rounded-full bg-zinc-200" />
      <span className="size-2.5 rounded-full bg-zinc-200" />
      <span className="ml-2 rounded-md border border-zinc-100 bg-white px-2.5 py-0.5 text-xs text-zinc-400">
        markbase.so
      </span>
    </div>
  );
}

function ReasonLink({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: typeof Box;
  label: string;
  active?: boolean;
}) {
  return (
    <a
      href={href}
      className={`flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-sm transition ${
        active ? "bg-[#f6ffd6] font-semibold text-zinc-900" : "font-medium text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      <Icon className="size-4" />
      {label}
    </a>
  );
}

function Panel({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="flex scroll-mt-28 flex-col gap-5 rounded-3xl border border-zinc-200 bg-zinc-50 p-6 md:p-8">
      <div className="flex flex-col gap-1.5">
        <h3 className={`${DISPLAY} text-[22px] font-semibold tracking-[-0.04em]`}>{title}</h3>
        <p className="max-w-xl text-[15px] leading-relaxed text-zinc-600">{lead}</p>
      </div>
      {children}
    </div>
  );
}

function MiniCard({ label, dark, children }: { label: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-xl px-4 py-3.5 ${dark ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white"}`}
    >
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">{children}</span>;
}

function RolePill({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-[13px]">
      <span className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function Step({
  n,
  title,
  body: text,
  dark,
  children,
}: {
  n: string;
  title: string;
  body: string;
  dark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div
        className={`relative h-60 overflow-hidden rounded-2xl p-5 ${dark ? "bg-zinc-900 text-white" : "border border-zinc-200 bg-white"}`}
      >
        {children}
        <span
          className={`absolute right-4 bottom-4 grid size-9 place-items-center rounded-full text-xs font-bold ${
            dark ? "bg-[#e5ff6e] text-zinc-900" : "bg-zinc-900 text-white"
          }`}
        >
          {n}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className={`${DISPLAY} text-[17px] font-semibold tracking-[-0.04em]`}>{title}</h3>
        <p className="text-sm leading-relaxed text-zinc-600">{text}</p>
      </div>
    </div>
  );
}

function CommentCard({ who, agent, text }: { who: string; agent?: boolean; text: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 px-3 py-2.5">
      <span className="flex items-center gap-1.5 text-xs font-semibold">
        {who}
        {agent && <span className="rounded bg-[#e5ff6e] px-1.5 py-px text-[10px] font-semibold">agent</span>}
      </span>
      <span className="text-xs leading-relaxed text-zinc-600">{text}</span>
    </div>
  );
}

/**
 * "Download for Mac", when there is a build to download.
 *
 * Points at the `releases/latest/download/…` permalink, which GitHub resolves to
 * the newest release — so publishing a build (apps/app/scripts/publish-dmg.sh)
 * needs no change here and nothing already linking to it goes stale. The
 * first-open note sits under the buttons in the closing section.
 */
function MacDownload({ version }: { version: string | null }) {
  // Defaults to the public permalink, so a deploy needs no environment change to
  // offer the current build. The env var stays as an override for pointing a
  // preview at some other build.
  const href = process.env.NEXT_PUBLIC_MAC_DOWNLOAD_URL ?? MAC_DOWNLOAD_URL;
  if (!href) return null;
  return (
    <a href={href} className={ghostBtn}>
      <Apple className="size-4" />
      Download for Mac
      <span className="font-normal text-zinc-400">{version ? `· v${version}` : ""}</span>
    </a>
  );
}
