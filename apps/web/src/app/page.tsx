import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SkillsLanding } from "./skills-landing";
import { MarkbaseLanding } from "./markbase-landing";
import { getCurrentUser } from "@/lib/supabase/server";

// One deployment serves several hosts, and the root is the one route that
// tells them apart: markbase.so gets the marketing landing, the skills host its
// own landing, and every other host — a self-hosted instance, a dev server — is
// the app, whose front door is the dashboard or, signed out, sign-in (which
// itself sends an empty instance to its admin set-up). Reading the Host header
// makes this route dynamic.
const SKILLS_HOST = "skills.markbase.so";

async function host(): Promise<string> {
  return ((await headers()).get("host") ?? "").split(":")[0];
}

async function isSkillsHost(): Promise<boolean> {
  const h = await host();
  // Prod skills host, plus `skills.localhost` for local dev.
  return h === SKILLS_HOST || h === "skills.localhost";
}

// The apex (markbase.so) is the marketing landing. `landing.localhost`
// previews it in local dev; a plain `localhost` is a dev instance like any
// other, so it opens the app, the way a self-hosted one does.
async function isApexHost(): Promise<boolean> {
  const h = await host();
  return h === "markbase.so" || h === "www.markbase.so" || h === "landing.localhost";
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

  // Any other host is the app.
  redirect((await getCurrentUser()) ? "/dashboard" : "/login");
}
