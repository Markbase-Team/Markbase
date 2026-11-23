import { docExcerpt } from "@markbase/shared/docs/excerpt";
import { GET_STARTED_TOOL, startSuggestions } from "@markbase/shared/docs/onboarding";
import { listDocumentsForUser, listVaultsForUser } from "../server";
import { endpoint } from "./define";
import { json } from "./respond";

/** How many of the newest documents the answer carries. */
const NEWEST = 5;

// GET — where to begin: the caller's vaults, their newest documents, and a
// few things to try. It is what an agent calls for a person who has just
// connected it and does not know what to ask; in an app that shows cards, the
// answer is drawn as the Get started card (@markbase/shared/docs/apps/start-app),
// whose buttons are the suggestions.
export const getStartedEndpoint = endpoint({
  id: GET_STARTED_TOOL,
  method: "GET",
  path: "/docs/start",
  capability: null,
  scope: "read",
  summary: "Where to begin: your vaults, newest documents and things to try",
  skill: {
    whenToUse:
      "When the person has just connected Markbase, asks what they can do with it, or is unsure where to begin. Offer what it suggests.",
    input: "(nothing)",
    output: "{ vaults: [{ id, name }], documents: [{ id, title, excerpt, vault_id, updated_at }], suggestions: [{ title, description, prompt }] }",
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/start" | jq '.suggestions'`,
  },
}, async (_req, _params, a) => {
  const [vaults, docs] = await Promise.all([
    listVaultsForUser(a.actor.userId),
    listDocumentsForUser(a.actor.userId),
  ]);
  const newest = docs.slice(0, NEWEST);
  return json({
    vaults: vaults.map((v) => ({ id: v.id, name: v.name })),
    documents: newest.map((d) => ({
      id: d.id,
      title: d.title,
      excerpt: docExcerpt(d.content_head),
      vault_id: d.vault_id,
      updated_at: d.updated_at,
    })),
    suggestions: startSuggestions(newest[0]?.title ?? null),
  });
});
