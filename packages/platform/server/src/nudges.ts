import { randomBytes } from "node:crypto";
import { NUDGE_EVENT, type NudgeChannel, type NudgeKind, type NudgePayload } from "@markbase/shared/sync-nudges";
import { supabase } from "./supabase";

// Sync nudges — the server half. Hands an account's machines the topic they
// listen on, and sends each account a nudge after a write that changed
// something its syncs keep (@markbase/shared/sync-nudges says why).
//
// Sending goes through Supabase Realtime's broadcast endpoint: the server
// holds no socket, so it posts the message and Realtime delivers it to
// whoever is listening. This file is the one place that knows that; another
// transport would replace `sendNudges` and nothing that calls it.

const TABLE = "sync_nudge_topics";
const TOPIC_PREFIX = "nudge:";

/** A new topic: a prefix and 32 random bytes. */
function newTopic(): string {
  return TOPIC_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * The topic an account's machines listen on, made the first time it is asked
 * for. Two machines asking at once both end up with the same one.
 */
export async function nudgeTopic(userId: string): Promise<string> {
  const { data: had, error: readError } = await supabase.from(TABLE).select("topic").eq("user_id", userId).maybeSingle();
  if (readError) throw new Error(`nudge topic could not be read: ${readError.message}`);
  if (had?.topic) return had.topic;
  const { error: insertError } = await supabase
    .from(TABLE)
    .upsert({ user_id: userId, topic: newTopic() }, { onConflict: "user_id", ignoreDuplicates: true });
  if (insertError) throw new Error(`nudge topic could not be made: ${insertError.message}`);
  const { data, error } = await supabase.from(TABLE).select("topic").eq("user_id", userId).single();
  if (error || !data?.topic) throw new Error(`nudge topic could not be read back: ${error?.message ?? "missing"}`);
  return data.topic;
}

/**
 * Where to listen: the account's topic, and the Supabase project's public URL
 * and publishable key — the same two a browser is built with. Null when this
 * deployment has no public Realtime to offer.
 */
export async function nudgeChannel(userId: string): Promise<NudgeChannel | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { topic: await nudgeTopic(userId), url, key };
}

/** As much of Realtime as sending needs, so a test can hand in a stub. */
export interface NudgeSender {
  topics(userIds: string[]): Promise<string[]>;
  send(topic: string, payload: NudgePayload): Promise<void>;
}

const realtimeSender: NudgeSender = {
  topics: async (userIds) => {
    // Only accounts that have asked for a topic have anything listening.
    const { data, error } = await supabase.from(TABLE).select("topic").in("user_id", userIds);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: { topic: string }) => row.topic);
  },
  send: async (topic, payload) => {
    const channel = supabase.channel(topic, { config: { private: false } });
    try {
      await channel.httpSend(NUDGE_EVENT, payload);
    } finally {
      void supabase.removeChannel(channel).catch(() => undefined);
    }
  },
};

/**
 * Nudge each account's machines that something of `kind` changed. Never
 * throws: a nudge that does not go out is a delay until the sync's safety
 * poll, not lost data. Returns how many topics were nudged.
 */
export async function sendNudges(userIds: string[], kind: NudgeKind, sender: NudgeSender = realtimeSender): Promise<number> {
  const accounts = [...new Set(userIds.filter(Boolean))];
  if (accounts.length === 0) return 0;
  try {
    const topics = await sender.topics(accounts);
    const sent = await Promise.allSettled(topics.map((topic) => sender.send(topic, { kind })));
    const failed = sent.filter((s) => s.status === "rejected").length;
    if (failed > 0) console.warn(`[nudges] ${failed} of ${topics.length} nudge(s) did not go out`);
    return topics.length - failed;
  } catch (err) {
    console.warn(`[nudges] not sent: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}
