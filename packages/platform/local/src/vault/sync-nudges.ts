import { createClient } from "@supabase/supabase-js";
import { NUDGE_EVENT, NUDGE_PATH, isNudgeKind, type NudgeChannel, type NudgeKind } from "@markbase/shared/sync-nudges";
import { fetchWithTimeout } from "@markbase/shared/timeout-fetch";
import { syncHeaders } from "./sync-headers";

// Sync nudges — the listening half, one per process: however many vaults a
// machine syncs, it holds one connection and hears its account's nudges once
// (@markbase/shared/sync-nudges says why nudges exist).
//
// While connected, a vault's sync asks the API what moved only when nudged,
// plus a slow safety poll; while not, it polls at its usual pace. Connecting
// or reconnecting counts as a nudge of every kind, since anything may have
// moved while nobody was listening.

export type NudgeListener = (kind: NudgeKind) => void;
export type ConnectionListener = (connected: boolean) => void;

/**
 * How nudges arrive — the seam another transport would replace. Connects to a
 * channel and reports what it hears and whether it is listening; returns the
 * way to disconnect.
 */
export type NudgeTransport = (
  channel: NudgeChannel,
  onNudge: (kind: NudgeKind) => void,
  onListening: (listening: boolean) => void
) => () => void;

/** Supabase Realtime: a public broadcast channel named by the account's topic. */
export const realtimeNudges: NudgeTransport = (channel, onNudge, onListening) => {
  const client = createClient(channel.url, channel.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const ch = client.channel(channel.topic, { config: { private: false, broadcast: { self: false } } });
  ch.on("broadcast", { event: NUDGE_EVENT }, (message: { payload?: { kind?: string } }) => {
    const kind = message.payload?.kind;
    if (isNudgeKind(kind)) onNudge(kind);
  });
  ch.subscribe((status) => onListening(status === "SUBSCRIBED"));
  return () => {
    void client.removeChannel(ch).catch(() => undefined);
    void client.realtime.disconnect();
  };
};

/** Asks the API where to listen. Null when this instance offers no nudges. */
export type FetchNudgeChannel = () => Promise<NudgeChannel | null>;

export interface SyncNudgesOptions {
  appUrl: string;
  /** The machine's key, read when it is needed: it can change while the app runs. */
  apiKey: () => string | null;
  log?: (message: string) => void;
  transport?: NudgeTransport;
  fetchChannel?: FetchNudgeChannel;
  /** Nudges of one kind closer together than this are passed on as one. */
  coalesceMs?: number;
  /** How long to wait before asking again where to listen, after not being told. */
  retryMs?: number;
}

const COALESCE_MS = 1_000;
const RETRY_MS = 5 * 60_000;

export class SyncNudges {
  private readonly nudgeListeners = new Set<NudgeListener>();
  private readonly connectionListeners = new Set<ConnectionListener>();
  private readonly pending = new Map<NudgeKind, ReturnType<typeof setTimeout>>();
  private disconnect: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;
  private stopped = false;

  constructor(private readonly opts: SyncNudgesOptions) {}

  /** Whether nudges are arriving right now. While not, syncs poll as they always did. */
  get connected(): boolean {
    return this.listening;
  }

  /** Hear of each nudge, already coalesced; returns the way to stop. */
  onNudge(listener: NudgeListener): () => void {
    this.nudgeListeners.add(listener);
    return () => {
      this.nudgeListeners.delete(listener);
    };
  }

  /** Hear when nudges start or stop arriving; returns the way to stop. */
  onConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  /** Find out where to listen and start listening. Never throws. */
  async start(): Promise<void> {
    if (this.stopped || this.disconnect) return;
    if (!this.opts.transport && typeof globalThis.WebSocket === "undefined") {
      // Node before 22 has no WebSocket of its own; polling still works.
      this.opts.log?.("no WebSocket in this Node.js; syncing by polling");
      return;
    }
    let channel: NudgeChannel | null = null;
    try {
      channel = await (this.opts.fetchChannel ?? this.defaultFetchChannel)();
    } catch (e) {
      this.opts.log?.(`couldn't ask where to listen: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (this.stopped) return;
    if (!channel) {
      this.retryLater();
      return;
    }
    this.disconnect = (this.opts.transport ?? realtimeNudges)(
      channel,
      (kind) => this.heard(kind),
      (listening) => this.setListening(listening)
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.disconnect?.();
    this.disconnect = null;
    this.setListening(false);
    this.nudgeListeners.clear();
    this.connectionListeners.clear();
  }

  private readonly defaultFetchChannel: FetchNudgeChannel = async () => {
    const key = this.opts.apiKey();
    if (!key) return null;
    const res = await fetchWithTimeout(`${this.opts.appUrl}${NUDGE_PATH}`, { headers: syncHeaders(key) });
    if (res.status !== 200) return null;
    const body = (await res.json()) as Partial<NudgeChannel>;
    return typeof body.topic === "string" && typeof body.url === "string" && typeof body.key === "string"
      ? { topic: body.topic, url: body.url, key: body.key }
      : null;
  };

  private retryLater(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, this.opts.retryMs ?? RETRY_MS);
  }

  private setListening(listening: boolean): void {
    if (listening === this.listening) return;
    this.listening = listening;
    this.opts.log?.(listening ? "listening for changes" : "not listening for changes; polling");
    for (const listener of [...this.connectionListeners]) listener(listening);
    // Anything may have moved while nobody was listening.
    if (listening) for (const kind of ["content", "structure"] as const) this.heard(kind);
  }

  /** Pass a nudge on, at most once per kind per `coalesceMs`. */
  private heard(kind: NudgeKind): void {
    if (this.stopped || this.pending.has(kind)) return;
    this.pending.set(
      kind,
      setTimeout(() => {
        this.pending.delete(kind);
        for (const listener of [...this.nudgeListeners]) listener(kind);
      }, this.opts.coalesceMs ?? COALESCE_MS)
    );
  }
}
