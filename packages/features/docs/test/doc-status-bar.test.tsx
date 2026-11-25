import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Editor } from "@tiptap/react";
import type { DocStatusAnswer } from "../src/ui/use-doc-status";

// The status line in the Properties panel, as a person sees it, from the
// answer GET /docs/:id/status gives. The hook that asks is mocked; what is
// under test is what each answer shows, and who gets the Confirm button.

let hook: {
  available: boolean;
  status: DocStatusAnswer | null;
  confirm: () => Promise<void>;
  confirming: boolean;
  error: string | null;
};
vi.mock("../src/ui/use-doc-status", () => ({ useDocStatus: () => hook }));

const { DocStatusBar } = await import("../src/ui/properties-panel");
const editor = {} as Editor;
const text = (editable = true): string =>
  renderToStaticMarkup(<DocStatusBar docId="doc_1" editor={editor} editable={editable} />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function answer(over: Partial<DocStatusAnswer> = {}, fields: Partial<DocStatusAnswer["fields"]> = {}): DocStatusAnswer {
  return {
    fields: { type: "doc", status: "stable", superseded_by: null, owner: null, audience: "both", covers: [], review_by: null, assignee: null, due: null, done: false, ...fields },
    warnings: [],
    last_meaningful_change: "2026-11-20T00:00:00.000Z",
    trust: "unverified",
    current_confirmations: [],
    needs_review: false,
    ...over,
  };
}

beforeEach(() => {
  hook = { available: true, status: answer(), confirm: async () => {}, confirming: false, error: null };
});

describe("DocStatusBar", () => {
  it("says the current text isn't confirmed, and offers an editor the Confirm button", () => {
    const shown = text();
    expect(shown).toContain("Not confirmed since the last change");
    expect(shown).toContain("Confirm");
  });

  it("names the person who confirmed the current text", () => {
    hook.status = answer({
      trust: "human_confirmed",
      current_confirmations: [
        { by: "agent:claude", at: "2026-11-21T00:00:00.000Z", name: "claude" },
        { by: "human:u1", at: "2026-11-22T12:00:00.000Z", name: "Jessie" },
      ],
    });
    expect(text()).toMatch(/Confirmed by Jessie · /);
  });

  it("says an agent's confirmation is an agent's", () => {
    hook.status = answer({
      trust: "agent_confirmed",
      current_confirmations: [{ by: "agent:claude", at: "2026-11-21T00:00:00.000Z", name: "claude" }],
    });
    expect(text()).toMatch(/Confirmed by claude \(agent\)/);
  });

  it("shows Draft, Deprecated with its replacement, and Review due", () => {
    hook.status = answer({}, { status: "draft" });
    expect(text()).toContain("Draft");
    hook.status = answer({ needs_review: true }, { status: "deprecated", superseded_by: "[[New runbook]]" });
    const shown = text();
    expect(shown).toContain("Deprecated · see [[New runbook]]");
    expect(shown).toContain("Review due");
    expect(shown).not.toContain("Draft");
  });

  it("counts property warnings, with the messages to hover", () => {
    hook.status = answer({
      warnings: [
        { field: "status", message: "`status: current` isn't one of draft, stable, deprecated; read as stable." },
        { field: "verified", message: "`verified` in front matter isn't counted. Confirm the document in Markbase instead." },
      ],
    });
    const html = renderToStaticMarkup(<DocStatusBar docId="doc_1" editor={editor} editable />);
    expect(text()).toContain("2 property warnings");
    expect(html).toContain("isn&#x27;t counted");
  });

  it("gives a reader no Confirm button", () => {
    const html = (editable: boolean) => renderToStaticMarkup(<DocStatusBar docId="doc_1" editor={editor} editable={editable} />);
    expect(html(true)).toContain("<button");
    expect(html(false)).not.toContain("<button");
  });

  it("says why a confirmation was refused", () => {
    hook.error = "You made the last change to this document, so someone else has to confirm it.";
    expect(text()).toContain("someone else has to confirm it");
  });

  it("shows nothing until there is an answer, or for a loose file with no server copy", () => {
    hook.status = null;
    expect(text()).toBe("");
    hook = { ...hook, status: answer(), available: false };
    expect(text()).toBe("");
  });
});
