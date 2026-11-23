import { supabase } from "../supabase";
import { isProvider } from "@markbase/shared/agent-sessions";
import {
  clampUserAnalyticsLimit,
  isUserAnalyticsAction,
  isUserAnalyticsChannel,
  isUserAnalyticsOutcome,
  userAnalyticsDetail,
  type UserAnalyticsActor,
  type UserAnalyticsEvent,
  type UserAnalyticsQuery,
  type UserAnalyticsRecord,
} from "@markbase/shared/analytics/user-analytics";

// User analytics — the server half. Writes one action to
// public.user_analytics_events and reads a customer's rows back. See
// @markbase/shared/analytics/user-analytics for what an event holds.
//
// Recording never throws and never fails a request: losing a line of the
// record is better than refusing the action it describes.

/** The row as the table holds it. */
export interface UserAnalyticsRow {
  owner_id: string;
  actor_kind: "person" | "agent";
  key_id: string | null;
  provider: string | null;
  client: string | null;
  channel: string;
  action: string;
  detail: string | null;
  vault_id: string | null;
  doc_id: string | null;
  outcome: string;
  status: number | null;
  duration_ms: number | null;
}

/** A row read back: the stored columns plus what the database added. */
export interface StoredUserAnalyticsRow extends UserAnalyticsRow {
  id: number;
  created_at: string;
}

interface StoreError {
  message: string;
}

/** As much of the database client as this needs, so a test can hand in a stub. */
export interface UserAnalyticsWriter {
  insert(row: UserAnalyticsRow): Promise<{ error: StoreError | null }>;
}

export interface UserAnalyticsReader {
  select(query: UserAnalyticsQuery, limit: number): Promise<{ data: StoredUserAnalyticsRow[] | null; error: StoreError | null }>;
}

const TABLE = "user_analytics_events";
const COLUMNS =
  "id, created_at, owner_id, actor_kind, key_id, provider, client, channel, action, detail, vault_id, doc_id, outcome, status, duration_ms";

const tableWriter: UserAnalyticsWriter = {
  insert: async (row) => {
    const { error } = await supabase.from(TABLE).insert(row);
    return { error };
  },
};

const tableReader: UserAnalyticsReader = {
  select: async (query, limit) => {
    let rows = supabase.from(TABLE).select(COLUMNS);
    rows = query.scope.kind === "owner" ? rows.eq("owner_id", query.scope.ownerId) : rows.in("doc_id", query.scope.docIds);
    if (query.vaultId) rows = rows.eq("vault_id", query.vaultId);
    if (query.docId) rows = rows.eq("doc_id", query.docId);
    if (query.channel) rows = rows.eq("channel", query.channel);
    if (query.action) rows = rows.eq("action", query.action);
    if (query.outcome) rows = rows.eq("outcome", query.outcome);
    if (query.since) rows = rows.gte("created_at", query.since);
    if (typeof query.before === "number") rows = rows.lt("id", query.before);
    const { data, error } = await rows.order("id", { ascending: false }).limit(limit).returns<StoredUserAnalyticsRow[]>();
    return { data, error };
  },
};

/** A whole number or null: a status or a duration is never a fraction, never negative. */
function wholeOrNull(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/** The row for an event. */
export function toUserAnalyticsRow(event: UserAnalyticsEvent): UserAnalyticsRow {
  const agent = event.actor.kind === "agent" ? event.actor : null;
  return {
    owner_id: event.ownerId,
    actor_kind: event.actor.kind,
    key_id: agent?.keyId ?? null,
    provider: agent?.provider ?? null,
    client: agent?.client ?? null,
    channel: event.channel,
    action: event.action,
    detail: userAnalyticsDetail(event.action, event.detail),
    vault_id: event.vaultId ?? null,
    doc_id: event.docId ?? null,
    outcome: event.outcome,
    status: wholeOrNull(event.status),
    duration_ms: wholeOrNull(event.durationMs),
  };
}

function actorOfRow(row: StoredUserAnalyticsRow): UserAnalyticsActor {
  if (row.actor_kind !== "agent" || !row.key_id) return { kind: "person" };
  return {
    kind: "agent",
    keyId: row.key_id,
    provider: isProvider(row.provider) ? row.provider : "unknown",
    client: row.client,
  };
}

/** A stored row as the API hands it out. Null for a row this code cannot read. */
export function toUserAnalyticsRecord(row: StoredUserAnalyticsRow): UserAnalyticsRecord | null {
  if (!isUserAnalyticsChannel(row.channel) || !isUserAnalyticsOutcome(row.outcome)) return null;
  return {
    id: row.id,
    at: row.created_at,
    actor: actorOfRow(row),
    channel: row.channel,
    action: row.action,
    detail: row.detail,
    vaultId: row.vault_id,
    docId: row.doc_id,
    outcome: row.outcome,
    status: row.status,
    durationMs: row.duration_ms,
  };
}

/** Whether it was written. Never throws. */
export async function recordUserAnalytics(
  event: UserAnalyticsEvent,
  writer: UserAnalyticsWriter = tableWriter
): Promise<boolean> {
  try {
    // The set of actions is closed (see isUserAnalyticsAction): a name the
    // registry does not know is a bug at the call site, not a row.
    if (!isUserAnalyticsAction(event.action)) {
      console.warn(`[user-analytics] unknown action not recorded: ${event.action.slice(0, 80)}`);
      return false;
    }
    const row = toUserAnalyticsRow(event);
    const { error } = await writer.insert(row);
    if (error) {
      console.warn(`[user-analytics] ${row.action} not recorded: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[user-analytics] ${event.action} not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * The rows a scope may see, newest first. Throws when the read fails: unlike
 * recording, a reader has asked a question and should hear that it went
 * unanswered.
 */
export async function listUserAnalytics(
  query: UserAnalyticsQuery,
  reader: UserAnalyticsReader = tableReader
): Promise<UserAnalyticsRecord[]> {
  // Nothing visible is an answer, and `in ()` with no ids is not valid to ask.
  if (query.scope.kind === "docs" && query.scope.docIds.length === 0) return [];
  const { data, error } = await reader.select(query, clampUserAnalyticsLimit(query.limit));
  if (error) throw new Error(`user analytics could not be read: ${error.message}`);
  return (data ?? []).flatMap((row) => {
    const record = toUserAnalyticsRecord(row);
    return record ? [record] : [];
  });
}
