import { describe, it, expect } from "vitest";
import {
  FRESH_ACCOUNT_MS,
  SIGNUP_SOURCE_COOKIE,
  captureSource,
  isFreshAccount,
  parseSource,
  readSourceCookie,
  serializeSource,
  shouldReplace,
  type SignupSource,
} from "@markbase/shared/analytics/funnel/signup-source";
import { recordSignupSource, type SignupSourceRow, type SourceWriter } from "../../../src/analytics/funnel/signup-source-store";

// Where a sign-up came from. The first visit is noted in a cookie; the account
// that browser later creates gets one row saying so.

const NOW = new Date("2026-11-18T04:42:00Z");

function source(over: Partial<SignupSource> = {}): SignupSource {
  return {
    referrer: "https://www.reddit.com/",
    landing_path: "/",
    utm_source: "",
    utm_medium: "",
    utm_campaign: "",
    utm_term: "",
    utm_content: "",
    first_seen_at: NOW.toISOString(),
    ...over,
  };
}

describe("captureSource", () => {
  it("keeps an outside referrer and the landing path with its query", () => {
    const s = captureSource({
      href: "https://markbase.so/blog/why-markdown?utm_source=reddit&utm_medium=comment&x=1",
      referrer: "https://www.reddit.com/r/ObsidianMD/comments/abc/",
      now: NOW,
    });
    expect(s).toEqual(
      source({
        referrer: "https://www.reddit.com/r/ObsidianMD/comments/abc/",
        landing_path: "/blog/why-markdown?utm_source=reddit&utm_medium=comment&x=1",
        utm_source: "reddit",
        utm_medium: "comment",
      })
    );
  });

  it("treats our own pages as no referrer at all", () => {
    const s = captureSource({
      href: "https://markbase.so/signup",
      referrer: "https://markbase.so/",
      now: NOW,
    });
    expect(s?.referrer).toBe("");
    expect(s?.landing_path).toBe("/signup");
  });

  it("drops a referrer that is not a URL", () => {
    expect(captureSource({ href: "https://markbase.so/", referrer: "not a url", now: NOW })?.referrer).toBe("");
  });

  it("clips absurd values so the cookie stays small", () => {
    const long = "x".repeat(2000);
    const s = captureSource({
      href: `https://markbase.so/?utm_campaign=${long}`,
      referrer: `https://example.com/${long}`,
      now: NOW,
    });
    expect(s?.referrer.length).toBe(512);
    expect(s?.landing_path.length).toBe(512);
    expect(s?.utm_campaign.length).toBe(128);
  });
});

describe("shouldReplace — first touch wins, tagged links excepted", () => {
  it("writes when there is nothing yet", () => {
    expect(shouldReplace(null, source())).toBe(true);
  });
  it("keeps the first visit over a later untagged one", () => {
    expect(shouldReplace(source(), source({ referrer: "https://www.google.com/" }))).toBe(false);
  });
  it("lets a campaign link replace an untagged first visit", () => {
    expect(shouldReplace(source(), source({ utm_source: "newsletter" }))).toBe(true);
  });
  it("does not let one campaign overwrite another", () => {
    expect(shouldReplace(source({ utm_source: "reddit" }), source({ utm_source: "newsletter" }))).toBe(false);
  });
});

describe("the cookie value", () => {
  it("round-trips through the serialized form", () => {
    const s = source({ utm_source: "reddit", landing_path: "/?a=b&c=d" });
    expect(parseSource(serializeSource(s))).toEqual(s);
  });

  it("is found among the browser's other cookies", () => {
    const value = serializeSource(source());
    const header = `sb-access=abc; ${SIGNUP_SOURCE_COOKIE}=${value}; theme=dark`;
    expect(readSourceCookie(header)).toBe(value);
    expect(readSourceCookie("theme=dark")).toBeNull();
  });

  it("refuses anything that is not a source", () => {
    expect(parseSource(null)).toBeNull();
    expect(parseSource("")).toBeNull();
    expect(parseSource("%7B")).toBeNull();
    expect(parseSource(encodeURIComponent("[1,2]"))).toBeNull();
    expect(parseSource(encodeURIComponent('{"referrer":"x"}'))).toBeNull();
    expect(parseSource(encodeURIComponent('{"first_seen_at":"yesterday"}'))).toBeNull();
  });

  it("fills in fields a tampered cookie left out or mistyped", () => {
    const s = parseSource(encodeURIComponent(JSON.stringify({ first_seen_at: NOW.toISOString(), utm_source: 7 })));
    expect(s).toEqual(source({ referrer: "", landing_path: "", utm_source: "" }));
  });
});

describe("isFreshAccount", () => {
  it("counts an account made inside the window", () => {
    expect(isFreshAccount(NOW.toISOString(), NOW)).toBe(true);
    expect(isFreshAccount(new Date(NOW.getTime() - FRESH_ACCOUNT_MS + 1000).toISOString(), NOW)).toBe(true);
  });
  it("does not count an older one, or none", () => {
    expect(isFreshAccount(new Date(NOW.getTime() - FRESH_ACCOUNT_MS - 1000).toISOString(), NOW)).toBe(false);
    expect(isFreshAccount(undefined, NOW)).toBe(false);
    expect(isFreshAccount("garbage", NOW)).toBe(false);
  });
});

describe("recordSignupSource", () => {
  function writer(error: { code?: string; message: string } | null = null) {
    const rows: SignupSourceRow[] = [];
    const w: SourceWriter = {
      insert: async (row) => {
        rows.push(row);
        return { error };
      },
    };
    return { w, rows };
  }
  const fresh = { id: "u1", created_at: NOW.toISOString() };

  it("writes one row, with empty fields as null", async () => {
    const { w, rows } = writer();
    const cookie = serializeSource(source({ utm_source: "reddit" }));
    expect(await recordSignupSource(fresh, cookie, NOW, w)).toBe("recorded");
    expect(rows).toEqual([
      {
        user_id: "u1",
        referrer: "https://www.reddit.com/",
        landing_path: "/",
        utm_source: "reddit",
        utm_medium: null,
        utm_campaign: null,
        utm_term: null,
        utm_content: null,
        first_seen_at: NOW.toISOString(),
      },
    ]);
  });

  it("does nothing without a cookie", async () => {
    const { w, rows } = writer();
    expect(await recordSignupSource(fresh, undefined, NOW, w)).toBe("no-cookie");
    expect(rows).toEqual([]);
  });

  it("does nothing for a log-in by an older account", async () => {
    const { w, rows } = writer();
    const old = { id: "u1", created_at: "2026-10-01T00:00:00Z" };
    expect(await recordSignupSource(old, serializeSource(source()), NOW, w)).toBe("not-new");
    expect(rows).toEqual([]);
  });

  it("reports a second write and a failure without throwing", async () => {
    const dup = writer({ code: "23505", message: "duplicate key" });
    expect(await recordSignupSource(fresh, serializeSource(source()), NOW, dup.w)).toBe("already");
    const down = writer({ message: "connection refused" });
    expect(await recordSignupSource(fresh, serializeSource(source()), NOW, down.w)).toBe("failed");
  });
});
