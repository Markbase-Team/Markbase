import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ProjectFinder } from "./project-finder";
import { SkillsLanding } from "./skills-landing";
import { MarkbaseLanding } from "./markbase-landing";
import { getCurrentUser } from "@/lib/supabase/server";

// One deployment serves several hosts; the root renders different content per
// host (apex marketing landing / Skills landing / the app's project finder).
// Reading the Host header makes this route dynamic.
const SKILLS_HOST = "skills.markbase.so";

async function host(): Promise<string> {
  return ((await headers()).get("host") ?? "").split(":")[0];
}

async function isSkillsHost(): Promise<boolean> {
  const h = await host();
  // Prod skills host, plus `skills.localhost` for local dev.
  return h === SKILLS_HOST || h === "skills.localhost";
}

// The apex (markbase.so) is the marketing landing.
// `landing.localhost` previews it in local dev.
async function isApexHost(): Promise<boolean> {
  const h = await host();
  return (
    h === "markbase.so" ||
    h === "www.markbase.so" ||
    h === "landing.localhost" ||
    h === "localhost"
  );
}

export async function generateMetadata() {
  if (await isSkillsHost()) {
    return {
      title: "Skills library",
      description:
        "Pull reusable Claude Code skills and push learnings & terms via API.",
    };
  }
  if (await isApexHost()) {
    return {
      title: "Markbase — one markdown folder for your team and its agents",
      description:
        "Google Docs for markdown, built AI-native. You and the agents you already use read, write, comment on, and publish the same living documents — one source of truth.",
      // Self-referential canonical guards against UTM/parameter duplicates.
      alternates: { canonical: "https://markbase.so" },
    };
  }
  return {};
}

export default async function Home() {
  if (await isSkillsHost()) {
    return <SkillsLanding />;
  }
  if (await isApexHost()) {
    return <MarkbaseLanding />;
  }

  // The app-host public ticket page. Signed-in owners belong on the dashboard,
  // not this customer-facing finder.
  if (await getCurrentUser()) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">Ticketing</h1>
      <p className="mt-3 max-w-prose text-muted-foreground">
        Enter your project name to open it and submit or track a request.
      </p>

      <ProjectFinder />

      <div className="mt-10">
        <Link
          href="/login"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
