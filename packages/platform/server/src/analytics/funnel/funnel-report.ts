import { supabase } from "../../supabase";
import { isEventSignal, type Funnel, type FunnelSignal } from "@markbase/shared/analytics/funnel/funnels";

// Funnels — the engine. Works out any declared funnel the same way: who
// entered it, and for each, when they first reached each later step.
//
// The rules, the same for every funnel:
//   - A subject enters at its first occurrence of the first step, inside the
//     period asked about. Its source is where that happened.
//   - A later step counts at the first time it happened at or after the step
//     before it, no later than `windowDays` after entering, and no sooner
//     than the step's `atLeastHoursAfterStart`. A step not reached ends the
//     subject's run: steps are in order.
//   - A step with several signals is reached by whichever came first.

const DAY_MS = 86_400_000;
const PAGE = 1_000;
const MAX_ROWS = 200_000;

/** One time a subject did what a signal describes. */
export interface Occurrence {
  subject: string;
  at: number;
  /** Where it happened: a funnel event's source, or a user analytics channel. */
  source: string | null;
}

/** As much of the two event logs as a funnel needs, so a test can hand in its own. */
export interface SignalReader {
  occurrences(signal: FunnelSignal, from: Date, to: Date): Promise<Occurrence[]>;
}

interface FunnelEventRow {
  user_id: string;
  created_at: string;
  source: string;
}
interface ActionRow {
  owner_id: string;
  created_at: string;
  channel: string;
}

async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
  console.warn(`[funnels] stopped at ${MAX_ROWS} rows for one signal; the report undercounts`);
  return rows;
}

const tableReader: SignalReader = {
  occurrences: async (signal, from, to) => {
    if (isEventSignal(signal)) {
      const rows = await allPages<FunnelEventRow>((a, b) => {
        let q = supabase
          .from("funnel_events")
          .select("user_id, created_at, source")
          .eq("name", signal.event)
          .gte("created_at", from.toISOString())
          .lt("created_at", to.toISOString());
        if (typeof signal.source === "string") q = q.eq("source", signal.source);
        else if (signal.source) q = q.in("source", [...signal.source]);
        for (const [key, value] of Object.entries(signal.where ?? {})) {
          q = typeof value === "string" ? q.eq(`props->>${key}`, value) : q.in(`props->>${key}`, [...value]);
        }
        return q.order("id").range(a, b).returns<FunnelEventRow[]>();
      });
      return rows.map((r) => ({ subject: r.user_id, at: Date.parse(r.created_at), source: r.source }));
    }
    const rows = await allPages<ActionRow>((a, b) => {
      let q = supabase
        .from("user_analytics_events")
        .select("owner_id, created_at, channel")
        .eq("outcome", "success")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString());
      if (signal.action !== "*") q = q.eq("action", signal.action);
      if (signal.actor) q = q.eq("actor_kind", signal.actor);
      if (signal.channel) q = q.eq("channel", signal.channel);
      return q.order("id").range(a, b).returns<ActionRow[]>();
    });
    return rows.map((r) => ({ subject: r.owner_id, at: Date.parse(r.created_at), source: r.channel }));
  },
};

export interface FunnelStepResult {
  id: string;
  label: string;
  reached: number;
  /** Of those who reached the step before; 1 for the first step. */
  ofPrevious: number;
  /** Of those who entered. */
  ofStart: number;
}

export interface FunnelSubjectRun {
  subject: string;
  /** Where the subject entered the funnel. */
  source: string | null;
  /** When each step was reached, ISO, or null from the first step not reached. */
  reachedAt: (string | null)[];
}

export interface FunnelReport {
  funnel: string;
  since: string;
  until: string;
  steps: FunnelStepResult[];
  /** The same counts, for the subjects that entered from each source. */
  bySource: Record<string, number[]>;
  /** The same counts, by the week (Monday, UTC) a subject entered. */
  byWeek: Record<string, number[]>;
  subjects: FunnelSubjectRun[];
}

/** Every occurrence of any of the step's signals, per subject, earliest first. */
async function stepOccurrences(signals: readonly FunnelSignal[], from: Date, to: Date, reader: SignalReader): Promise<Map<string, Occurrence[]>> {
  const lists = await Promise.all(signals.map((s) => reader.occurrences(s, from, to)));
  const bySubject = new Map<string, Occurrence[]>();
  for (const o of lists.flat()) {
    const list = bySubject.get(o.subject);
    if (list) list.push(o);
    else bySubject.set(o.subject, [o]);
  }
  for (const list of bySubject.values()) list.sort((a, b) => a.at - b.at);
  return bySubject;
}

function weekOf(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday is 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

function counts(runs: FunnelSubjectRun[], steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => runs.filter((r) => r.reachedAt[i] !== null).length);
}

/** Work out a funnel for the subjects that entered it in [since, until). */
export async function runFunnel(
  funnel: Funnel,
  period: { since: Date; until: Date },
  reader: SignalReader = tableReader
): Promise<FunnelReport> {
  const windowMs = funnel.windowDays * DAY_MS;
  const [first, ...rest] = funnel.steps;

  const entries = await stepOccurrences(first.signals, period.since, period.until, reader);
  const runs = new Map<string, { entry: Occurrence; times: (number | null)[] }>();
  for (const [subject, list] of entries) runs.set(subject, { entry: list[0], times: [list[0].at] });

  const laterTo = new Date(period.until.getTime() + windowMs);
  for (const step of rest) {
    const found = await stepOccurrences(step.signals, period.since, laterTo, reader);
    for (const [subject, run] of runs) {
      const previous = run.times[run.times.length - 1];
      if (previous === null) {
        run.times.push(null);
        continue;
      }
      const notBefore = Math.max(previous, run.entry.at + (step.atLeastHoursAfterStart ?? 0) * 3_600_000);
      const deadline = run.entry.at + windowMs;
      const hit = (found.get(subject) ?? []).find((o) => o.at >= notBefore && o.at <= deadline);
      run.times.push(hit ? hit.at : null);
    }
  }

  const subjects: FunnelSubjectRun[] = [...runs].map(([subject, run]) => ({
    subject,
    source: run.entry.source,
    reachedAt: run.times.map((t) => (t === null ? null : new Date(t).toISOString())),
  }));
  subjects.sort((a, b) => (a.reachedAt[0] ?? "").localeCompare(b.reachedAt[0] ?? ""));

  const totals = counts(subjects, funnel.steps.length);
  const steps: FunnelStepResult[] = funnel.steps.map((step, i) => ({
    id: step.id,
    label: step.label,
    reached: totals[i],
    ofPrevious: i === 0 ? 1 : totals[i - 1] ? totals[i] / totals[i - 1] : 0,
    ofStart: totals[0] ? totals[i] / totals[0] : 0,
  }));

  const group = (key: (run: FunnelSubjectRun) => string): Record<string, number[]> => {
    const groups = new Map<string, FunnelSubjectRun[]>();
    for (const run of subjects) {
      const k = key(run);
      groups.set(k, [...(groups.get(k) ?? []), run]);
    }
    return Object.fromEntries([...groups].map(([k, rs]) => [k, counts(rs, funnel.steps.length)]));
  };

  return {
    funnel: funnel.id,
    since: period.since.toISOString(),
    until: period.until.toISOString(),
    steps,
    bySource: group((r) => r.source ?? "unknown"),
    byWeek: group((r) => weekOf(Date.parse(r.reachedAt[0] ?? ""))),
    subjects,
  };
}

/** A report as plain text: the steps, then the same by source and by week. */
export function formatFunnelReport(funnel: Funnel, report: FunnelReport): string {
  const pct = (n: number): string => `${Math.round(n * 100)}%`.padStart(5);
  const lines = [
    `${funnel.title} (${funnel.id})`,
    `entered ${report.since.slice(0, 10)} to ${report.until.slice(0, 10)}, steps within ${funnel.windowDays} days`,
    "",
    ...report.steps.map((s, i) => `${String(i + 1).padStart(2)}. ${s.label.padEnd(48)} ${String(s.reached).padStart(5)}  ${pct(s.ofPrevious)} of previous  ${pct(s.ofStart)} of start`),
  ];
  for (const [title, groups] of [
    ["by source", report.bySource],
    ["by week entered", report.byWeek],
  ] as const) {
    lines.push("", title);
    for (const [key, row] of Object.entries(groups)) lines.push(`  ${key.padEnd(12)} ${row.map((n) => String(n).padStart(5)).join("")}`);
  }
  return lines.join("\n");
}
