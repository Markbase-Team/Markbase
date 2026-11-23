// `npm run funnel -w @markbase/web -- <funnel> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--subjects]`
//
// Works out a declared funnel against the database the environment names
// (SUPABASE_URL + SUPABASE_KEY; .env.local when present) and prints it. With
// no funnel, lists the funnels there are. Reads only.
import "../src/lib/funnels";
import { funnelById, listFunnels } from "@markbase/shared/analytics/funnel/funnels";
import { formatFunnelReport, runFunnel } from "@markbase/server/analytics/funnel/funnel-report";

const DAY_MS = 86_400_000;

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function day(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: ${value} (YYYY-MM-DD)`);
  return d;
}

async function main(): Promise<void> {
  const id = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  if (!id) {
    console.log("Funnels:");
    for (const f of listFunnels()) console.log(`  ${f.id.padEnd(16)} ${f.title} (${f.steps.length} steps, ${f.windowDays} day window)`);
    return;
  }
  const funnel = funnelById(id);
  if (!funnel) throw new Error(`No funnel ${id}. Run with no arguments to list them.`);
  const until = day(flag("--until"), new Date(Date.now() + DAY_MS));
  const since = day(flag("--since"), new Date(until.getTime() - 31 * DAY_MS));
  const report = await runFunnel(funnel, { since, until });
  console.log(formatFunnelReport(funnel, report));
  if (process.argv.includes("--subjects")) {
    console.log("\nsubjects (account id, source, when each step was reached)");
    for (const s of report.subjects) {
      console.log(`  ${s.subject.slice(0, 8)} ${(s.source ?? "?").padEnd(8)} ${s.reachedAt.map((t) => (t ? t.slice(0, 16) : "-").padEnd(17)).join("")}`);
    }
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
