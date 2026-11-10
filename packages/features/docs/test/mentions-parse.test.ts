import { describe, it, expect } from "vitest";
import { parseMentions, stripMentionSyntax } from "../src/logic/mentions";

const A = "f6a3bccc-e80d-4a49-904c-ec1f9f945a99";
const B = "3e160b49-1111-4222-8333-444455556666";

describe("parseMentions", () => {
  it("pulls the agent id out of a comment body", () => {
    expect(parseMentions(`[@Roadmap](agent:${A}) what next?`)).toEqual([A]);
  });

  it("de-dupes and preserves first-seen order", () => {
    const md = `[@B](agent:${B}) and [@A](agent:${A}) and [@B again](agent:${B})`;
    expect(parseMentions(md)).toEqual([B, A]);
  });

  it("ignores ordinary links and near-misses", () => {
    expect(parseMentions("see [docs](https://markbase.so)")).toEqual([]);
    expect(parseMentions("[@x](agent:not-a-uuid)")).toEqual([]);
    expect(parseMentions("agent:" + A)).toEqual([]); // not link syntax
  });

  it("is empty for blank input", () => {
    expect(parseMentions("")).toEqual([]);
  });
});

describe("stripMentionSyntax", () => {
  it("reduces a mention to readable text", () => {
    expect(stripMentionSyntax(`Hey [@Roadmap](agent:${A}), thoughts?`)).toBe(
      "Hey @Roadmap, thoughts?"
    );
  });
  it("leaves ordinary links intact", () => {
    const md = "see [docs](https://markbase.so)";
    expect(stripMentionSyntax(md)).toBe(md);
  });
});
