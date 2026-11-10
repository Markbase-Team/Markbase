import {
  fetchInstance,
  normalizeInstanceUrl,
  type InstanceInfo,
} from "@markbase/protocol/instance";
import {
  appUrl,
  CONFIG_PATH,
  DEFAULT_APP_URL,
  loadConfig,
  savedInstance,
  saveInstance,
  usesDefaultInstance,
} from "./config";

// Pointing this machine at a Markbase instance.
//
// A team that hosts its own Markbase (SELF-HOSTING.md) has one URL, and that URL
// is all a team member should need — the way a Grafana is joined. The CLI needs
// nothing more: everything it does goes through the API. The desktop app does:
// its windows join a document's live channel on the instance's Supabase project
// directly, with the project's public URL and publishable key, which used to be
// the hosted app's, compiled in. So the instance says which project it runs on
// (GET /api/v1/instance, public), and connecting saves the answer next to the
// key — in the file the desktop app reads at launch.
//
// What the URL means and whether the instance's answer is usable is shared with
// the desktop app (@markbase/protocol/instance), which has the same control in
// its window; this file is the command around it.

export { fetchInstance, normalizeInstanceUrl, type InstanceInfo };

/**
 * `--app-url <url>` or `--app-url=<url>` among `args`, or null. The rest of the
 * arguments are left for the command to read as before.
 */
export function appUrlFlag(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--app-url") return args[i + 1] ?? null;
    if (a.startsWith("--app-url=")) return a.slice("--app-url=".length);
  }
  return null;
}

/**
 * Point this machine at `raw`. Verifies the instance answers before anything is
 * written, so a typo leaves the previous instance in place.
 */
export async function connectInstance(raw: string): Promise<InstanceInfo> {
  const base = normalizeInstanceUrl(raw);
  const info = await fetchInstance(base);
  await saveInstance({
    appUrl: base,
    supabaseUrl: info.supabase_url,
    supabaseKey: info.supabase_publishable_key,
  });
  return info;
}

/** `markbase instance [url]`: show the instance this machine talks to, or change it. */
export async function runInstance(args: string[]): Promise<void> {
  const target = args.find((a) => !a.startsWith("-"));
  if (!target) {
    const base = appUrl();
    const where = usesDefaultInstance() ? `${base} (the hosted app)` : base;
    console.log(`Instance:  ${where}`);
    // The project the instance said it runs on — kept for the desktop window's
    // live-edit channel; the CLI itself holds no database credential.
    const saved = savedInstance();
    if (saved && saved.appUrl === base) console.log(`Supabase:  ${saved.supabaseUrl}`);
    if (process.env.MARKBASE_APP_URL ?? process.env.APP_URL) {
      console.log("           (from MARKBASE_APP_URL / APP_URL in the environment)");
    }
    console.log(`\nChange it: markbase instance <url>   (e.g. ${DEFAULT_APP_URL}, or your team's)`);
    return;
  }
  const info = await connectInstance(target);
  console.log(`Connected to ${appUrl()} — Supabase project ${info.supabase_url}.`);
  console.log(`Saved to ${CONFIG_PATH}; the desktop app reads the same file.`);
  if (!loadConfig().apiKey) {
    console.log("\nNext: markbase login");
  } else {
    console.log(
      "\nYour saved API key belongs to the previous instance. Run `markbase login` to sign in to this one."
    );
  }
}
