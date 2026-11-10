import { describe, it, expect } from "vitest";
import {
  CALLER_HEADER,
  callerFromHeaders,
  parseCaller,
  serializeCaller,
  type Caller,
} from "../src/auth";

// The caller header has one writer and one reader, and the only thing that
// matters about them is that they agree — including on the values a header
// cannot carry raw, and on what a value the writer never produced means.

const SESSION: Caller = {
  via: "session",
  ownerId: "owner_1",
  email: "owner@example.com",
};
const KEY: Caller = {
  via: "api_key",
  ownerId: "owner_1",
  key: { id: "key_1", provider: "claude_code", capability: "commenter" },
};

describe("the caller header", () => {
  it("round-trips a session", () => {
    expect(parseCaller(serializeCaller(SESSION))).toEqual(SESSION);
  });

  it("round-trips a key, ceiling included", () => {
    expect(parseCaller(serializeCaller(KEY))).toEqual(KEY);
  });

  it("round-trips a key with no ceiling", () => {
    const open: Caller = { ...KEY, key: { ...KEY.key, capability: null } };
    expect(parseCaller(serializeCaller(open))).toEqual(open);
  });

  it("serializes to printable ASCII, whatever the email holds", () => {
    // An HTTP header field cannot carry this character; a JSON escape can.
    const s = serializeCaller({ ...SESSION, email: "jöhn@example.com" });

    expect(s).toMatch(/^[\x20-\x7e]*$/);
    expect(parseCaller(s)).toEqual({ ...SESSION, email: "jöhn@example.com" });
  });

  it("reads the header off a request, and null when it is absent", () => {
    const headers = new Headers({ [CALLER_HEADER]: serializeCaller(KEY) });

    expect(callerFromHeaders(headers)).toEqual(KEY);
    expect(callerFromHeaders(new Headers())).toBeNull();
  });

  it("reads a provider or ceiling it does not know the way the key store does", () => {
    // Both mirror what @markbase/node/api-keys does when it reads the row: a
    // provider it does not know is `unknown`, a ceiling it does not know is
    // none. The gate only ever writes values it read that way, so this is the
    // reader agreeing with the writer, not a policy of its own.
    const parsed = parseCaller(
      JSON.stringify({
        via: "api_key",
        ownerId: "owner_1",
        key: { id: "key_1", provider: "not_a_tool", capability: "admin" },
      })
    );

    expect(parsed).toEqual({
      via: "api_key",
      ownerId: "owner_1",
      key: { id: "key_1", provider: "unknown", capability: null },
    });
  });

  it("refuses a value that is present but is not a caller", () => {
    // Only the gate writes this header. A value it could not have written is a
    // bug there, and a bug there must not read as "nobody is signed in".
    for (const bad of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ via: "session" }),
      JSON.stringify({ via: "api_key", ownerId: "o" }),
      JSON.stringify({ via: "magic", ownerId: "o" }),
    ]) {
      expect(() => parseCaller(bad), bad).toThrow(CALLER_HEADER);
    }
  });
});
