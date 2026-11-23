import {
  diffSegments,
  docAnalytics,
  listVersions,
  markdownToDoc,
  versionContent,
  type DocJSON,
} from "@markbase/shared/docs";
import { callerFromHeaders } from "@markbase/shared/auth";
import {
  HOOK_EVENTS_MAX,
  HOOK_EVENTS_MAX_DOCS,
  HOOK_EVENT_NEEDS,
  parseHookEvents,
  type HookEvent,
  type HookEventsAnswer,
  type HookEventsBody,
} from "@markbase/shared/analytics/hook-events";
import { readDocCrdt, recordHookEvent, recordedDocReads, searchDocuments } from "../server";
import { nudgeChannel } from "@markbase/server/nudges";
import type { NudgeChannel } from "@markbase/shared/sync-nudges";
import { requireDocCapability } from "./actor";
import { endpoint } from "./define";
import { json } from "./respond";

// The read-only half of the docs API: search, the three version views and the
// analytics, all of which read a document's CRDT without changing it.

// GET ?q=…&vault=… (or ?scope=shared) — search the caller's documents by
// title + markdown content, scoped like the sidebar that calls it.
// Search, as the sidebar does it.
export const searchDocsEndpoint = endpoint({
  id: "docs_searchDocs",
  method: "GET",
  path: "/docs/search",
  capability: null,
  scope: "read",
  params: [
    { name: "q", type: "string", required: true, description: "What to look for, in titles and in the text." },
    { name: "vault", type: "string", description: "Only the documents in one of your vaults." },
    { name: "scope", type: "string", description: "`shared`: only documents other people shared with you." },
  ],
  summary: "Search your documents by title and text",
  skill: {
    whenToUse:
      "To find a document by what it says rather than listing them all and reading each.",
    input: "?q=<words> · ?vault=<id> · ?scope=shared",
    output: "{ hits: [{ id, title, snippet }] }",
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/search?q=roadmap" | jq '.hits'`,
  },
}, async (req, _params, a) => {
  const params = new URL(req.url).searchParams;
  const shared = params.get("scope") === "shared";
  const hits = await searchDocuments(a.actor.userId, {
    query: params.get("q") ?? "",
    // Shared-with-me searches across owners' vaults, so a vault filter is moot.
    vaultId: shared ? undefined : (params.get("vault") ?? undefined),
    shared,
  });
  return json({ hits });
});

// GET — the document's version history from its CRDT (one entry per settled
// edit), oldest first. Each version has a 0-based `index` used by /at, /diff
// and /restore.
export const historyEndpoint = endpoint({
  id: "docs_history",
  method: "GET",
  path: "/docs/:id/history",
  capability: "viewer",
  scope: "read",
  summary: "Version history (who changed what, +added/−removed)",
  skill: {
    whenToUse: "To see how a document evolved or find a version to restore.",
    input: "",
    output: '{ version, revisions: [{ from_version, to_version, author, added, removed }] }',
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/history" | jq '.revisions'`,
  },
}, async (_req, { id }, auth) => {
  const versions = await readDocCrdt(id, auth.doc.content, (doc) =>
    listVersions(doc)
  );
  return json({ version: versions.length, revisions: versions });
});

// GET — the document's analytics from its CRDT: which agents read it and for
// whom, and who wrote each line that is in it now. The one place every surface
// asks — the Analytics panel on the web and the desktop, and an agent's tool.
export const analyticsEndpoint = endpoint({
  id: "docs_analytics",
  method: "GET",
  path: "/docs/:id/analytics",
  capability: "viewer",
  scope: "read",
  summary: "Analytics (which agents read it and for whom, who wrote each line)",
  skill: {
    whenToUse:
      "To see which agents read a document and on whose behalf, or who wrote what is in it now — a person, or an agent and whose agent.",
    input: "",
    output:
      '{ reads: [{ agent, owner, count, lastAt, text }], credit: { lines, shares: [{ writer, text, lines }], ranges: [{ from, to, writer, text, preview }] } } — text is the writer in words ("Jessie\'s Claude"); writer.kind is agent, person, mixed or unrecorded; credit is null when the history cannot be read',
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/$ID/analytics" | jq '.credit.shares'`,
  },
}, async (_req, { id }, auth) => {
  // Reads come from the record (user analytics); line credit from the
  // document's own history. Asked for together.
  const recorded = await recordedDocReads(id);
  return json(await readDocCrdt(id, auth.doc.content, (doc) => docAnalytics(doc, recorded)));
});

// GET ?version=V — the document as of CRDT version index V, for previewing a
// past version. V is the 0-based `index` from /history.
// Lower-level endpoints (used by the editor / power users; not in the skill).
export const docAtEndpoint = endpoint({
  id: "docs_docAt",
  method: "GET",
  path: "/docs/:id/at",
  capability: "viewer",
  scope: "read",
  params: [
    { name: "version", type: "number", required: true, description: "Version to read." },
  ],
  summary: "The document as of a version",
}, async (req, { id }, auth) => {
  const version = Number(new URL(req.url).searchParams.get("version"));
  if (!Number.isFinite(version) || version < 0) {
    return json({ error: "version (>= 0) required" }, 400);
  }
  try {
    const doc_json = await readDocCrdt(
      id,
      auth.doc.content,
      (doc) => markdownToDoc(versionContent(doc, version)).toJSON() as DocJSON
    );
    return json({ doc_json, version });
  } catch (e) {
    // versionContent throws for an index that doesn't exist.
    return json(
      { error: e instanceof Error ? e.message : `No version ${version}` },
      404
    );
  }
});

// GET ?from=X&to=Y — inline word-diff of the markdown between two CRDT
// version indices (from /history). from <= to.
export const docDiffEndpoint = endpoint({
  id: "docs_docDiff",
  method: "GET",
  path: "/docs/:id/diff",
  capability: "viewer",
  scope: "read",
  params: [
    { name: "from", type: "number", required: true, description: "Older version." },
    { name: "to", type: "number", required: true, description: "Newer version." },
  ],
  summary: "Word-level diff between two versions",
}, async (req, { id }, auth) => {
  const url = new URL(req.url);
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
    return json({ error: "from and to (from <= to) required" }, 400);
  }
  try {
    const segments = await readDocCrdt(id, auth.doc.content, (doc) =>
      diffSegments(versionContent(doc, from), versionContent(doc, to))
    );
    return json({ segments });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "No such version" },
      404
    );
  }
});

// POST /api/v1/hook-events — a sync daemon reporting what agents' hooks saw
// on its machine: one event per read or write of a vault file, as the hook
// logged it (@markbase/shared/analytics/hook-events).
//
// An agent working on a file never touches the API, so its hook is the only
// witness, and the daemon is what carries the hook's ledger here. Each event
// becomes a row in the user analytics record, under the daemon's account.
//
// Account-level, because one sweep covers many documents; the role each event
// needs is checked here, per document: viewer to report a read of it, editor
// to report a write. An event for a document the caller may not reach is not
// recorded, and the answer says so, event by event.
export const reportHookEventsEndpoint = endpoint({
  id: "docs_reportHookEvents",
  method: "POST",
  path: "/hook-events",
  capability: null,
  scope: "write",
  summary: "Report what agents' hooks saw of vault files: reads and writes, one event each",
  humanOnly: true,
  why: "The sync daemon's report of its machine's hook ledgers. An agent's own calls are recorded as they happen.",
}, async (req) => {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return json({ error: "Missing credentials." }, 401);
  let body: HookEventsBody = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const events = parseHookEvents(body);
  if (!events) {
    return json(
      { error: `events must be 1 to ${HOOK_EVENTS_MAX} of { kind, agent, docId, at }, naming at most ${HOOK_EVENTS_MAX_DOCS} documents` },
      400
    );
  }

  // Each document and role once, however many events name it.
  const allowed = new Map<string, Promise<boolean>>();
  const may = (event: HookEvent): Promise<boolean> => {
    const need = HOOK_EVENT_NEEDS[event.kind];
    const key = `${event.docId}\n${need}`;
    let check = allowed.get(key);
    if (!check) {
      check = requireDocCapability(req, event.docId, need).then((auth) => auth.ok);
      allowed.set(key, check);
    }
    return check;
  };

  const recorded = await Promise.all(
    events.map(async (event) => (await may(event)) && (await recordHookEvent(caller, event)))
  );
  const answer: HookEventsAnswer = { recorded };
  return json(answer);
});

// GET /api/v1/nudge — where this account's machines listen to hear that
// something changed (@markbase/shared/sync-nudges). A vault sync asks once
// when it starts and then polls slowly, asking the API what moved only when
// nudged. 404 when this deployment has no public Realtime to offer; the sync
// then keeps polling as it always did.
export const nudgeChannelEndpoint = endpoint({
  id: "docs_nudgeChannel",
  method: "GET",
  path: "/nudge",
  capability: null,
  scope: "read",
  summary: "Where this account's syncs listen for changes",
  humanOnly: true,
  why: "The topic a vault sync listens on to hear that something changed. Nothing an agent would ask for.",
}, async (req) => {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return json({ error: "Missing credentials." }, 401);
  const channel: NudgeChannel | null = await nudgeChannel(caller.ownerId);
  if (!channel) return json({ error: "This instance offers no change notifications." }, 404);
  return json(channel);
});
