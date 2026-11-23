import { describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", () => ({ supabase: {} }));

import { sendNudges, type NudgeSender } from "../src/nudges";
import type { NudgePayload } from "@markbase/shared/sync-nudges";

// Sending nudges: each account once, only to accounts that listen, and never
// a failed request because a nudge did not go out.

function stub(topicsOf: Record<string, string>, failing: string[] = []): { sender: NudgeSender; sent: [string, NudgePayload][]; asked: string[][] } {
  const sent: [string, NudgePayload][] = [];
  const asked: string[][] = [];
  return {
    sent,
    asked,
    sender: {
      topics: async (ids) => {
        asked.push(ids);
        return ids.flatMap((id) => (topicsOf[id] ? [topicsOf[id]] : []));
      },
      send: async (topic, payload) => {
        if (failing.includes(topic)) throw new Error("down");
        sent.push([topic, payload]);
      },
    },
  };
}

describe("sendNudges", () => {
  it("nudges each account that listens, once, with the kind of change", async () => {
    const { sender, sent, asked } = stub({ u1: "nudge:a", u2: "nudge:b" });
    expect(await sendNudges(["u1", "u2", "u1", "u3", ""], "structure", sender)).toBe(2);
    expect(asked).toEqual([["u1", "u2", "u3"]]);
    expect(sent).toEqual([
      ["nudge:a", { kind: "structure" }],
      ["nudge:b", { kind: "structure" }],
    ]);
  });

  it("does nothing for nobody", async () => {
    const { sender, asked } = stub({});
    expect(await sendNudges([], "content", sender)).toBe(0);
    expect(asked).toEqual([]);
  });

  it("counts a nudge that did not go out, and never throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sender } = stub({ u1: "nudge:a", u2: "nudge:b" }, ["nudge:b"]);
    expect(await sendNudges(["u1", "u2"], "content", sender)).toBe(1);
    const broken: NudgeSender = { topics: async () => Promise.reject(new Error("db down")), send: async () => undefined };
    expect(await sendNudges(["u1"], "content", broken)).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
