import {
  BUILTIN_VIEWS,
  getMarkdown,
  parseViewSpec,
  requiredProperties,
  runView,
  setMarkdown,
  withFrontmatterField,
  type ViewSpec,
  type JSONValue,
} from "@markbase/shared/docs";
import { editDocCrdt, queryDocuments, readDocCrdt, type SignedInActor } from "../server";
import { endpoint } from "./define";
import { json } from "./respond";

// Views and properties: the two general tools doc types need (design: "Doc
// types v2: fixed core, user types, rules" in the Markbase vault). Nothing
// here is about any one kind of document. Today is the built-in view
// `today` over documents of `type: task`; marking a task done is setting its
// `done` property.

/** The most candidates one query looks at; a view over more says it was cut short. */
const MAX_CANDIDATES = 2000;

/** Who `$me` is: a person by account, an agent by tool. */
function meOf(actor: SignedInActor): string {
  return actor.kind === "agent" ? `agent:${actor.agent?.tool ?? actor.name}` : `human:${actor.userId}`;
}

/** A time zone name Intl knows, or null. */
function timeZoneOrNull(tz: string | null): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

// GET ?view=today | ?spec=<json> — the documents a view shows.
export const queryViewEndpoint = endpoint({
  id: "docs_queryView",
  method: "GET",
  path: "/docs/views",
  capability: null,
  scope: "read",
  params: [
    { name: "view", type: "string", description: `A built-in view by name: ${Object.keys(BUILTIN_VIEWS).join(", ")}. "today" is your open tasks (documents of type: task) by when they are due.` },
    { name: "spec", type: "json", description: "Or a view of your own: { filter, sort, group_by, columns, limit }. A filter is { field, op, value } (op: eq ne in exists missing lt lte gt gte), or { all | any: [...] } or { not }. Values may be $me, $today, $today+7d. Fields are front matter, plus $title $path $updated_at." },
    { name: "tz", type: "string", description: "The time zone days are counted in, e.g. America/Los_Angeles (default UTC)." },
  ],
  summary: "Query a view: documents filtered, sorted and grouped by their properties",
  skill: {
    whenToUse:
      "To find documents by their front matter rather than their words: what is on someone's plate (view=today), or any filter, sort and grouping of your own over the documents you can open.",
    input: "?view=today&tz=America/Los_Angeles · ?spec={\"filter\":{\"field\":\"type\",\"op\":\"eq\",\"value\":\"incident\"}}",
    output:
      "{ name, title, today, time_zone, rows: [{ id, title, path, vault_id, updated_at, fields }], groups?: [{ key, rows }], truncated }",
    example: `curl -s -H "$AUTH" -H "$CLIENT" "$BASE/docs/views?view=today&tz=America/Los_Angeles" | jq '.groups'`,
  },
}, async (req, _params, a) => {
  const params = new URL(req.url).searchParams;
  const name = params.get("view");
  const raw = params.get("spec");
  let spec: ViewSpec;
  if (name) {
    const builtin = BUILTIN_VIEWS[name];
    if (!builtin) return json({ error: `No view called ${name}. Built-in views: ${Object.keys(BUILTIN_VIEWS).join(", ")}.` }, 404);
    spec = builtin;
  } else if (raw) {
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ error: "spec isn't JSON" }, 400);
    }
    const parsed = parseViewSpec(input);
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    spec = parsed.spec;
  } else {
    return json({ error: "Name a view (view=today) or give one (spec=…)." }, 400);
  }

  const candidates = await queryDocuments({ userId: a.actor.userId, contains: requiredProperties(spec), limit: MAX_CANDIDATES });
  const timeZone = timeZoneOrNull(params.get("tz")) ?? "UTC";
  const result = runView(spec, candidates, { me: meOf(a.actor), now: new Date(), timeZone });
  return json({ ...result, truncated: candidates.length >= MAX_CANDIDATES });
});

/** A front matter key a person or agent may set here. */
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
/** Never set this way: confirmations are recorded by docs_verifyDoc, not typed. */
const RESERVED = new Set(["verified"]);

// POST { key, value } — set one front matter field, in the caller's name.
export const setPropertyEndpoint = endpoint({
  id: "docs_setProperty",
  method: "POST",
  path: "/docs/:id/properties",
  capability: "editor",
  scope: "write",
  params: [
    { name: "key", type: "string", required: true, description: "The front matter field, e.g. done, due, assignee, status." },
    { name: "value", type: "json", required: true, description: "Its new value: text, a number, true/false, null, or a list." },
  ],
  summary: "Set one property (front matter field) of a document",
  skill: {
    whenToUse:
      "To change one field of a document's front matter without touching the rest: mark a task done (done: true), move a due date, reassign it (assignee: human:<id> or agent:<name>), deprecate a doc (status: deprecated).",
    input: "{ key: string, value: JSON }",
    output: "{ key, value }",
    example: `curl -s -X POST -H "$AUTH" -H "$CLIENT" -H 'content-type: application/json' -d '{"key":"done","value":true}' "$BASE/docs/$ID/properties"`,
  },
}, async (req, { id }, auth) => {
  let body: { key?: unknown; value?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (typeof body.key !== "string" || !KEY_RE.test(body.key)) {
    return json({ error: "key must be a field name (letters, digits, _ . -)" }, 400);
  }
  if (RESERVED.has(body.key)) {
    return json({ error: `\`${body.key}\` isn't set by hand. Confirm the document with docs_verifyDoc instead.` }, 400);
  }
  if (!("value" in body)) return json({ error: "value is required (null to empty it)" }, 400);
  const key = body.key;
  const value = body.value as JSONValue;

  const before = await readDocCrdt(id, auth.doc.content, getMarkdown);
  const after = withFrontmatterField(before, key, value);
  if (after !== before) {
    await editDocCrdt(id, auth.doc.content, { actor: auth.actor, label: `Set ${key}` }, (doc) => {
      setMarkdown(doc, withFrontmatterField(getMarkdown(doc), key, value));
    });
  }
  return json({ key, value });
});
