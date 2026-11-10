// Supabase Realtime adapter for the CRDT sync transport (roadmap F1, cloud half).
//
// Implements the DocPubSub shape the SyncSession expects over one Realtime
// broadcast channel per document. Yjs updates are binary, transported as base64
// text.
//
// Only the pub/sub half lives here now. Snapshots used to be read and written
// by every client straight into docs.doc_crdt with the publishable key; since
// security lockdown stage 2 the web API is the only reader and writer of that
// table (crdt-api.ts is what a client uses; server/crdt-store.ts is what the
// API uses), and a client's Realtime connection carries nothing but live
// deltas.
//
// Who may join: the channel is PRIVATE (`doc:<docId>`), so Realtime checks the
// socket's JWT against the policies in the stage-2 migration — a viewer may
// receive, an editor may send, a stranger gets neither. That is the browser,
// which has a session. The server publishes to it with the secret key. The
// daemons and the desktop app hold an API key and no JWT, so they are not on
// Realtime at all; see crdt-api.ts.
//
// The legacy PUBLIC `crdt:<docId>` channel is relayed for one release: a client
// still on the old build hears new clients' edits there and new clients hear
// its. LEGACY_PUBLIC_RELAY goes with the follow-up that revokes the public
// grants.

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@markbase/protocol/supabase";
import type { DocPubSub } from "./transport";

export {
  DB_MAX_ATTEMPTS,
  dbRetryDelay,
  isTransientDbError,
  retryingDb,
  type DbError,
  type DbResult,
} from "./db-retry";

// Portable base64 (browser + Node): btoa/atob operate on binary strings.
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The private channel a document's live edits travel on. */
export function docTopic(docId: string): string {
  return `doc:${docId}`;
}

/** The public channel the pre-stage-2 clients still use. */
export function legacyDocTopic(docId: string): string {
  return `crdt:${docId}`;
}

/**
 * Relay every publish and subscribe to the legacy public channel as well.
 *
 * TRANSITIONAL. True until every daemon and desktop app is on a build that
 * saves through the API; the follow-up migration that revokes the public grants
 * sets this false and deletes the legacy topic. While it is true the public
 * channel carries exactly what it carried before stage 2 — no more exposed than
 * yesterday, and no less — so the switch to private channels never cuts an
 * old client off mid-edit.
 */
export const LEGACY_PUBLIC_RELAY = true;

const UPDATE_EVENT = "update";

interface DocChannels {
  live: RealtimeChannel;
  legacy: RealtimeChannel | null;
}

/** Relay Yjs updates over a Supabase Realtime broadcast channel per document. */
export class SupabaseDocPubSub implements DocPubSub {
  private readonly channels = new Map<string, DocChannels>();

  constructor(
    private readonly client: SupabaseClient = supabase,
    private readonly legacyRelay: boolean = LEGACY_PUBLIC_RELAY
  ) {}

  private ensure(docId: string): DocChannels {
    let chs = this.channels.get(docId);
    if (!chs) {
      chs = {
        live: this.client.channel(docTopic(docId), {
          config: { broadcast: { self: false }, private: true },
        }),
        legacy: this.legacyRelay
          ? this.client.channel(legacyDocTopic(docId), { config: { broadcast: { self: false } } })
          : null,
      };
      this.channels.set(docId, chs);
    }
    return chs;
  }

  /**
   * Send an update to the document's channel(s). On a channel this client has
   * joined it goes over the socket; on one it has not — the server, which only
   * ever publishes — it is posted to the broadcast endpoint instead, so a
   * subscriber-less sender still reaches every subscriber. realtime-js used to
   * make that choice itself inside send(); it now asks for it explicitly.
   *
   * Resolves once the send has settled, so a request handler can await it
   * rather than return while the message is still in flight. Never rejects:
   * a broadcast that does not go out is a missed keystroke for other clients,
   * which the CRDT reconciles on their next sync — but it is SAID, because a
   * silent miss looked, for a while, like live update not working at all.
   */
  async publish(docId: string, update: Uint8Array): Promise<void> {
    const payload = { u: bytesToBase64(update) };
    const chs = this.ensure(docId);
    const targets = chs.legacy ? [chs.live, chs.legacy] : [chs.live];
    await Promise.all(targets.map((ch) => sendOn(ch, docId, payload)));
  }

  subscribe(docId: string, onUpdate: (update: Uint8Array) => void): () => void {
    const chs = this.ensure(docId);
    const deliver = (msg: { payload: { u: string } }): void =>
      onUpdate(base64ToBytes(msg.payload.u));
    for (const ch of chs.legacy ? [chs.live, chs.legacy] : [chs.live]) {
      ch.on("broadcast", { event: UPDATE_EVENT }, deliver);
      ch.subscribe();
    }
    return () => {
      const c = this.channels.get(docId);
      if (!c) return;
      this.channels.delete(docId);
      for (const ch of c.legacy ? [c.live, c.legacy] : [c.live]) {
        void this.client.removeChannel(ch).catch(() => {});
      }
    };
  }
}

async function sendOn(
  ch: RealtimeChannel,
  docId: string,
  payload: { u: string }
): Promise<void> {
  const say = (why: string) =>
    console.warn(`[crdt] broadcast for ${docId} on ${ch.topic} did not go out: ${why}`);
  try {
    if (ch.state === "joined") {
      const status = await ch.send({ type: "broadcast", event: UPDATE_EVENT, payload });
      if (status !== "ok") say(status);
    } else {
      await ch.httpSend(UPDATE_EVENT, payload);
    }
  } catch (e) {
    say(e instanceof Error ? e.message : String(e));
  }
}
