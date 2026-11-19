import { afterEach, describe, it, expect, vi } from "vitest";
import { makeAdopt } from "../src/vault-sync-run";

// A new file the daemon uploads goes up with who wrote it: the agent whose hook
// recorded the write, or null for the person. The server credits the
// document's first version to that writer, not to the daemon's own key.

type Sent = { title: string; path: string; adopt: boolean; written_by?: { agent: string | null } };

function stubFetch(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ doc: { id: "doc_1" } }), { status: 201 });
    })
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("makeAdopt", () => {
  it("sends the agent the hook named", async () => {
    const sent = stubFetch();
    const adopt = makeAdopt("https://markbase.example", "jsk_test", () => {}, "vault_1", () => "claude");
    expect(await adopt("notes.md", "# Notes\n")).toBe("doc_1");
    expect(sent[0]).toMatchObject({ path: "notes.md", adopt: true, written_by: { agent: "claude" } });
  });

  it("sends the person (no agent) when no hook recorded it", async () => {
    const sent = stubFetch();
    const writtenBy = vi.fn((): string | null => null);
    await makeAdopt("https://markbase.example", "jsk_test", () => {}, "vault_1", writtenBy)("a/b.md", "text\n");
    expect(writtenBy).toHaveBeenCalledWith("a/b.md", "text\n");
    expect(sent[0].written_by).toEqual({ agent: null });
  });

  it("says nothing about the writer when it was not told how to know", async () => {
    const sent = stubFetch();
    await makeAdopt("https://markbase.example", "jsk_test", () => {}, "vault_1")("notes.md", "# Notes\n");
    expect(sent[0]).not.toHaveProperty("written_by");
  });
});
