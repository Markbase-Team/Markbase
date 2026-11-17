# Adding an endpoint (and its MCP tool)

A documents endpoint is written once. That one definition is the API route, the
access rule, the MCP tool, the entry in the agent skill and the `markbase api`
command. You do not write any of those separately, and you cannot ship one
without the others.

This covers everything under `/api/v1/docs`, `/api/v1/vaults` and
`/api/v1/assets`. The few routes the web app serves itself (`/me`,
`/agent/tools`) are covered at the end.

## The short version

1. Define the endpoint beside its code, in `packages/features/docs/src/handlers/`.
2. Run `npm run gen:endpoints`.
3. Commit what it wrote, with your change.

Agents get the new tool when the site deploys. There is nothing to publish.

## 1. Define it

```ts
// packages/features/docs/src/handlers/history.ts
export const wordCountEndpoint = endpoint(
  {
    id: "docs_wordCount",           // the MCP tool's name; docs_<verbNoun>
    method: "GET",
    path: "/docs/:id/word-count",
    capability: "viewer",           // who may call it
    scope: "read",                  // "read" for GET, "write" for the rest
    params: [
      { name: "tab", type: "string", description: "Count one tab only." },
    ],
    summary: "How many words a document has",   // what the agent is told
  },
  async (req, { id }, auth) => {
    const words = await readDocCrdt(id, auth.doc.content, (doc) => countWords(getMarkdown(doc)));
    return json({ words });
  }
);
```

What each part does:

| Field | Meaning |
| --- | --- |
| `id` | The tool name, the skill heading's key and the `markbase api` command. Unique, `docs_` then a verb and a noun. |
| `method`, `path` | The route. `:name` segments are path parameters and arrive in the second argument. |
| `capability` | The access rule. `viewer`, `commenter`, `editor` or `owner` means "this role on the document `:id` names". `null` means account-level: any signed-in caller. |
| `scope` | What an API key must be allowed to do. `read` for `GET`, `write` otherwise. |
| `params` | Query parameters (`GET`, `DELETE`) or JSON body fields (`POST`, `PUT`, `PATCH`). They become the tool's input schema. |
| `summary` | One line. It is the tool's description. |
| `skill` | Optional. `whenToUse`, `input`, `output`, `example`: adds a full section to the agent skill, and `whenToUse` is appended to the tool's description. |
| `destructive` | `true` if it removes something that cannot be brought back. Agents' apps can then ask before running it. |
| `humanOnly` + `why` | Hide it from agents. `why` is required and is read in review; see below. |

### The access check is not yours to write

`endpoint()` checks the caller from `capability` before your code runs:

- **A role on a document:** the caller must hold at least that role on the
  document. Your code receives `auth`, with `auth.doc` (the row), `auth.actor`
  (who is asking, person or agent) and `auth.capability` (what they hold).
- **`null`:** the caller must be signed in. Your code receives `{ userId }`.
  Anything narrower is yours to check, for example that a vault is the
  caller's (`ownVault` in `handlers/vaults.ts`).

Do not call `requireDocCapability` or `accountActor` yourself. If the rule
really depends on what is asked for, use `selfCheckedEndpoint(def, because,
run)` and say why in `because`; `docs_listAssets` is the only one today.

### Hiding an endpoint from agents

Everything is a tool unless it says otherwise:

```ts
humanOnly: true,
why: "The folder mirror's write. An agent replacing a whole document overwrites what people are typing.",
```

Good reasons so far: it is transport for the editor or the sync daemon, it
takes a file upload a tool call cannot carry, or it is a decision that belongs
to the person (their folder layout, leaving a share). "Agents don't need it"
is not one; an agent that can do everything a person can is the point.

## 2. Generate

```bash
npm run gen:endpoints
```

It writes three things from your definition:

| File | For |
| --- | --- |
| `packages/features/docs/src/logic/endpoints.generated.ts` | The plain description. The CLI, the MCP server and the browser read this; they cannot import the handler, which is server code. |
| `skills/markbase/SKILL.md` | The agent skill. |
| `apps/web/src/app/api/v1/…/route.ts` | The route file, one line per method. |

Never edit those by hand. Tests fail if any of them differs from what the
definitions generate, so a forgotten `gen:endpoints` shows up in CI, not in
production.

## 3. What happens after merge

- **The API** serves the route on deploy.
- **MCP:** the MCP server asks the site for its tools (`GET /api/v1/agent/tools`)
  each time it starts, so every agent has the new tool on its next start. No
  npm release is involved. The copy of the list inside the published CLI is
  only a fallback for when the site cannot be reached.
- **The skill** file changes in the repo; people who installed it get the new
  text when they reinstall or update it.

## Changing or removing an endpoint

Same three steps. Change the definition (or delete it), run
`npm run gen:endpoints`, commit. Renaming an `id` renames the tool: agents
that learned the old name will get "Unknown tool" until they list tools again,
so prefer adding a new endpoint over renaming a used one.

## Testing it

Call the endpoint the way a route does:

```ts
const res = await wordCountEndpoint.handle(req(VIEWER), { id: "doc_1" });
```

`handle` includes the access check, so a test of "a stranger gets 404" or "a
viewer cannot edit" needs nothing extra. See
`packages/features/docs/test/crdt-handlers.test.ts` for the mocks.

## Routes outside the documents feature

`/me`, `/me/profile` and `/agent/tools` are hand-written route files in
`apps/web`, described in `ACCOUNT_ENDPOINTS` in
`packages/features/docs/src/logic/endpoints.ts`. Add the entry there and the
route file yourself. `apps/web/test/api-registry.test.ts` fails if a route
under `apps/web/src/app/api/v1` has no entry, or an entry has no route. A
route that should not be an endpoint at all (sign-in plumbing, say) goes in
that test's `NOT_REGISTERED` list with its reason.

## Why it is built this way

- **One place.** Description, rule and code used to be three files kept in
  step by hand. A route could exist that agents never heard of, and a rule
  could say one thing in the skill and another in the handler.
- **The check is in the wrapper** so no handler can forget it or check
  something other than what it advertises.
- **A generated copy, not an import,** because the description ships to npm
  and to browsers and the handler must not.
- **Tools from the server, not the package,** so the tools match the backend
  that will answer them, whatever version of the CLI someone has installed.
