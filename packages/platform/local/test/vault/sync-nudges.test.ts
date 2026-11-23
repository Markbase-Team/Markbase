import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NudgeChannel, NudgeKind } from "@markbase/shared/sync-nudges";
import { SyncNudges, type NudgeTransport } from "../../src/vault/sync-nudges";

// The listening half: one connection per process, nudges passed on coalesced,
// and every kind assumed when listening starts, since anything may have moved
// while nobody was.

const CHANNEL: NudgeChannel = { topic: "nudge:t", url: "https://p.test", key: "pk" };

function fakeTransport(): { transport: NudgeTransport; nudge: (kind: NudgeKind) => void; listening: (on: boolean) => void; closed: () => boolean; joined: () => NudgeChannel | null } {
  let onNudge: (kind: NudgeKind) => void = () => undefined;
  let onListening: (on: boolean) => void = () => undefined;
  let joined: NudgeChannel | null = null;
  let closed = false;
  return {
    transport: (channel, nudge, listening) => {
      joined = channel;
      onNudge = nudge;
      onListening = listening;
      return () => {
        closed = true;
      };
    },
    nudge: (kind) => onNudge(kind),
    listening: (on) => onListening(on),
    closed: () => closed,
    joined: () => joined,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("SyncNudges", () => {
  it("listens where the API says, and says when it is listening", async () => {
    const t = fakeTransport();
    const nudges = new SyncNudges({ appUrl: "x", apiKey: () => "k", transport: t.transport, fetchChannel: async () => CHANNEL });
    const states: boolean[] = [];
    nudges.onConnection((c) => states.push(c));
    await nudges.start();
    expect(t.joined()).toEqual(CHANNEL);
    expect(nudges.connected).toBe(false);
    t.listening(true);
    t.listening(false);
    expect(states).toEqual([true, false]);
  });

  it("passes nudges on, one per kind however many arrive close together", async () => {
    const t = fakeTransport();
    const nudges = new SyncNudges({ appUrl: "x", apiKey: () => "k", transport: t.transport, fetchChannel: async () => CHANNEL, coalesceMs: 100 });
    const heard: NudgeKind[] = [];
    nudges.onNudge((k) => heard.push(k));
    await nudges.start();
    for (let i = 0; i < 5; i++) t.nudge("content");
    t.nudge("structure");
    vi.advanceTimersByTime(100);
    expect(heard.sort()).toEqual(["content", "structure"]);
    t.nudge("content");
    vi.advanceTimersByTime(100);
    expect(heard).toHaveLength(3);
  });

  it("counts starting to listen as a nudge of every kind", async () => {
    const t = fakeTransport();
    const nudges = new SyncNudges({ appUrl: "x", apiKey: () => "k", transport: t.transport, fetchChannel: async () => CHANNEL, coalesceMs: 10 });
    const heard: NudgeKind[] = [];
    nudges.onNudge((k) => heard.push(k));
    await nudges.start();
    t.listening(true);
    vi.advanceTimersByTime(10);
    expect(heard.sort()).toEqual(["content", "structure"]);
  });

  it("asks again later when the API offers nowhere to listen", async () => {
    const t = fakeTransport();
    let asked = 0;
    const nudges = new SyncNudges({
      appUrl: "x",
      apiKey: () => "k",
      transport: t.transport,
      fetchChannel: async () => (++asked === 1 ? null : CHANNEL),
      retryMs: 1_000,
    });
    await nudges.start();
    expect(t.joined()).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(asked).toBe(2);
    expect(t.joined()).toEqual(CHANNEL);
  });

  it("disconnects and goes quiet when stopped", async () => {
    const t = fakeTransport();
    const nudges = new SyncNudges({ appUrl: "x", apiKey: () => "k", transport: t.transport, fetchChannel: async () => CHANNEL, coalesceMs: 10 });
    const heard: NudgeKind[] = [];
    nudges.onNudge((k) => heard.push(k));
    await nudges.start();
    t.listening(true);
    nudges.stop();
    vi.advanceTimersByTime(50);
    expect(t.closed()).toBe(true);
    expect(nudges.connected).toBe(false);
    expect(heard).toEqual([]);
  });
});
