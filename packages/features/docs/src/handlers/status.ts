import {
  confirmsOwnChange,
  docStatus,
  getMarkdown,
  lastMeaningfulChange,
  listVersions,
  versionContents,
  type ActorRef,
  type VersionText,
} from "@markbase/shared/docs";
import type * as Y from "yjs";
import { addConfirmation, listConfirmations, ownerDisplayName, readDocCrdt, type Actor } from "../server";
import { endpoint } from "./define";
import { json } from "./respond";

// Doc types, layer 1: what Markbase works out about a document (its core
// fields, any warnings about them, how trusted its current text is, whether a
// review is due), and the one write that feeds the trust: a confirmation.
// Design: "Doc types v2: fixed core, user types, rules" in the Markbase vault.
//
// Confirmations live in docs.doc_confirmations, written only here as the
// signed-in caller. Nothing in the document's text can add one.

/**
 * The actor as Markbase names it: `human:<user id>` for a person,
 * `agent:<tool>` for an agent. A guest has no account, so no name that would
 * still mean them tomorrow.
 */
export function actorRef(actor: Actor): ActorRef | null {
  if (actor.kind === "user") return `human:${actor.userId}`;
  if (actor.kind === "agent") return `agent:${actor.agent?.tool ?? actor.name}`;
  return null;
}

/** A person's name for a `human:<user id>` reference; other actors read as they are written. */
async function nameOf(by: ActorRef): Promise<string> {
  if (!by.startsWith("human:")) return by.slice(by.indexOf(":") + 1) || by;
  return ownerDisplayName(by.slice("human:".length));
}

/** The document's markdown and every version, oldest first, with who each credits. */
function textAndHistory(doc: Y.Doc): { markdown: string; versions: VersionText[] } {
  const contents = versionContents(doc);
  return {
    markdown: getMarkdown(doc),
    versions: listVersions(doc).map((v, i) => ({
      at: v.at,
      content: contents[i],
      author: v.author,
      agents: v.agents,
      mixed: v.mixed,
    })),
  };
}

// GET — the document's status, worked out from its front matter, history and confirmations.
export const docStatusEndpoint = endpoint({
  id: "docs_docStatus",
  method: "GET",
  path: "/docs/:id/status",
  capability: "viewer",
  scope: "read",
  summary: "Status (core fields, warnings, trust, whether a review is due)",
  skill: {
    whenToUse:
      "To know how far to trust a document before relying on it: whether anyone confirmed its current text (a person or an agent), whether it is deprecated, and whether a review is due.",
    input: "",
    output:
      "{ fields: { type, status, superseded_by, owner, audience, covers, review_by }, warnings: [{ field, message }], last_meaningful_change, trust: unverified | agent_confirmed | human_confirmed, current_confirmations: [{ by, at, name }], needs_review }",
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/status" | jq '{trust, needs_review}'`,
  },
}, async (_req, { id }, auth) => {
  const [{ markdown, versions }, confirmations] = await Promise.all([
    readDocCrdt(id, auth.doc.content, textAndHistory),
    listConfirmations(id),
  ]);
  const report = docStatus(markdown, versions, confirmations);
  const current_confirmations = await Promise.all(
    report.current_confirmations.map(async (c) => ({ ...c, name: await nameOf(c.by) })),
  );
  return json({ ...report, current_confirmations });
});

// POST — confirm the document's current text is right, as the caller.
export const verifyDocEndpoint = endpoint({
  id: "docs_verifyDoc",
  method: "POST",
  path: "/docs/:id/verify",
  capability: "editor",
  scope: "write",
  summary: "Confirm the current text is right, as you",
  skill: {
    whenToUse:
      "Only after checking the document against its source (the code, the system, the person who knows) and finding it right. Recorded in your name; the next meaningful edit ends it. You can't confirm a change you made.",
    input: "",
    output: "{ verified: { by, at }, trust }  ·  409 if you made the last change",
    example: `curl -s -X POST -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/verify"`,
  },
}, async (_req, { id }, auth) => {
  const actor = auth.actor;
  const by = actorRef(actor);
  if (!by || actor.kind === "guest") return json({ error: "Sign in to confirm a document." }, 403);

  const { markdown, versions } = await readDocCrdt(id, auth.doc.content, textAndHistory);
  const changed = lastMeaningfulChange(versions);
  const confirmer =
    actor.kind === "agent"
      ? { kind: "agent" as const, tool: actor.agent?.tool ?? actor.name }
      : { kind: "human" as const, name: actor.name };
  if (confirmsOwnChange(changed, confirmer)) {
    return json({ error: "You made the last change to this document, so someone else has to confirm it." }, 409);
  }

  await addConfirmation({ docId: id, userId: actor.userId, actor: by, version: Math.max(versions.length - 1, 0) });
  const report = docStatus(markdown, versions, await listConfirmations(id));
  const verified = report.current_confirmations.at(-1) ?? { by, at: new Date().toISOString() };
  return json({ verified, trust: report.trust });
});
