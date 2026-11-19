import { describe, expect, it } from "vitest";
import { relativeTime } from "@markbase/ui/relative-time";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const at = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it("rounds the last minute to 'just now', including a clock that runs ahead", () => {
    expect(relativeTime(at(0), NOW)).toBe("just now");
    expect(relativeTime(at(59_000), NOW)).toBe("just now");
    expect(relativeTime(at(-5 * 60_000), NOW)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeTime(at(44 * 60_000), NOW)).toBe("44 minutes ago");
    expect(relativeTime(at(60 * 60_000), NOW)).toBe("1 hour ago");
    expect(relativeTime(at(9 * 3_600_000), NOW)).toBe("9 hours ago");
    expect(relativeTime(at(26 * 3_600_000), NOW)).toBe("yesterday");
    expect(relativeTime(at(3 * 86_400_000), NOW)).toBe("3 days ago");
  });

  it("falls back to the date after a week", () => {
    const iso = at(8 * 86_400_000);
    expect(relativeTime(iso, NOW)).toBe(new Date(iso).toLocaleDateString());
  });

  it("is empty for a value that is not a date", () => {
    expect(relativeTime("", NOW)).toBe("");
  });
});
