# @markbase/attention

Email-triage **Attention boards**: drag an email onto a board and a cheap model
(OpenRouter) classifies + files it. Ships the data layer (`server`), framework-
agnostic API route handlers (`routes`), a drag-and-drop board UI (`ui`,
built on [`@markbase/ui`](../ui)'s `Kanban`), the SQL `migrations`, and a `migrate`
CLI.

Not published to npm — installed from GitHub via the auto-generated
`pkg-attention` branch.

## Install (into another project)

```bash
npm i github:Markbase-Team/Markbase#pkg-attention
```

This pulls `@markbase/ui` automatically (its dep is pinned to `#pkg-ui`).

**1. Next.js** — `next.config.ts`:

```ts
const nextConfig = {
  transpilePackages: ["@markbase/attention", "@markbase/ui"],
};
```

**2. Tailwind v4** — scan both packages:

```css
@source "../../node_modules/@markbase/attention/src";
@source "../../node_modules/@markbase/ui/src";
```

**3. Environment** (server-side):

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL` + `SUPABASE_KEY` | secret-key DB access (tables are RLS-locked) |
| `OPENROUTER_API_KEY` | the classifier |
| `OPENROUTER_MODEL` | optional; default `google/gemini-2.5-flash-lite` |
| `DATABASE_URL` | only for the `migrate` CLI (direct Postgres URL) |

## Database setup

```bash
# applies the bundled migrations idempotently; --seed adds example boards
DATABASE_URL="postgresql://…" npx attention migrate --seed
```

## Wire it up

```ts
// app/api/v1/attention/route.ts
import { attentionBoardsHandler } from "@markbase/attention/handlers";
import { getAdminUser } from "@/lib/supabase/server";
export const GET = attentionBoardsHandler(async () => !!(await getAdminUser()));
```

Mirror the other handlers (`attentionClassifyHandler`, `attentionItemHandler`,
`attentionBoardHandler`, `attentionCreateBoardHandler`, `attentionReorderHandler`,
`attentionFiledHandler`) onto routes under `/api/v1/attention/*`, then render
the board:

```tsx
import { AttentionView } from "@markbase/attention/ui";
export default function Page() {
  return <AttentionView />;
}
```

Drag a card between boards to recategorize (auto-approves); the model files
confident matches and flags the rest as "needs approval".

## Releasing

Merge to `main`; the `release-packages` Action regenerates `pkg-attention`
(and rewrites the `@markbase/ui` dep to `#pkg-ui`). A `prepare` script builds the
CLI (`dist/cli.js`) on install.
