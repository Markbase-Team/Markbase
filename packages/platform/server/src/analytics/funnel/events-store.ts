import { supabase } from "../../supabase";
import { isFunnelEventName, type FunnelEvent } from "@markbase/shared/analytics/funnel/events";

// Funnel events — the server half. Writes one event to public.funnel_events
// for an account: one a page reported (POST /api/v1/funnel-events), or one
// the server saw itself (an account signing up). See
// @markbase/shared/analytics/funnel/events for what may be recorded.

export interface FunnelEventRow {
  user_id: string;
  name: string;
  source: string;
  props: Record<string, string>;
}

/** As much of the database client as this needs, so a test can hand in a stub. */
export interface EventWriter {
  insert(row: FunnelEventRow): Promise<{ error: { message: string } | null }>;
  /**
   * Whether the account already has this event — at all, or since a time and
   * from a source, for one kept once a day.
   */
  has?(userId: string, name: string, within?: { since: string; source: string }): Promise<boolean>;
}

const TABLE = "funnel_events";

const tableWriter: EventWriter = {
  insert: async (row) => {
    const { error } = await supabase.from(TABLE).insert(row);
    return { error };
  },
  has: async (userId, name, within) => {
    let q = supabase.from(TABLE).select("id", { count: "exact", head: true }).eq("user_id", userId).eq("name", name);
    if (within) q = q.gte("created_at", within.since).eq("source", within.source);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  },
};

/** Whether it was written. Never throws: an event is not worth a failed request. */
export async function recordFunnelEvent(
  userId: string,
  event: FunnelEvent,
  writer: EventWriter = tableWriter
): Promise<boolean> {
  // The set is closed on this side too: a name nobody declared is a bug at
  // the call site, not a row.
  if (!isFunnelEventName(event.name)) {
    console.warn(`[funnel-events] ${event.name} is not a declared funnel event; not recorded`);
    return false;
  }
  try {
    const { error } = await writer.insert({ user_id: userId, name: event.name, source: event.source, props: event.props });
    if (error) {
      console.warn(`[funnel-events] ${event.name} not recorded: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[funnel-events] ${event.name} not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Record an event that happens to an account once (signing up), unless it is
 * already there. Two callers at the same instant may both write it; a funnel
 * counts an account's first time, so that costs nothing.
 */
export async function recordFunnelEventOnce(
  userId: string,
  event: FunnelEvent,
  writer: EventWriter = tableWriter
): Promise<boolean> {
  try {
    if (await (writer.has ?? tableWriter.has)?.(userId, event.name)) return false;
  } catch (err) {
    console.warn(`[funnel-events] ${event.name} not checked: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  return recordFunnelEvent(userId, event, writer);
}

/** Midnight UTC of the day `now` falls in, ISO. */
function startOfDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Record an event kept at most once a day (UTC) per account and source
 * ("app.open"), unless today's is already there. True when it was written.
 */
export async function recordFunnelEventDaily(
  userId: string,
  event: FunnelEvent,
  writer: EventWriter = tableWriter,
  now: Date = new Date()
): Promise<boolean> {
  try {
    if (await (writer.has ?? tableWriter.has)?.(userId, event.name, { since: startOfDay(now), source: event.source })) return false;
  } catch (err) {
    console.warn(`[funnel-events] ${event.name} not checked: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  return recordFunnelEvent(userId, event, writer);
}
