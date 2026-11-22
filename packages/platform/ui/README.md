# @markbase/ui

Shared UI library: shadcn/ui primitives plus higher-level components — a
drag-and-drop **`Kanban`** board (dnd-kit) and a **`Markdown`** renderer.

Not published to npm. Installed from GitHub via a dedicated, auto-generated
branch (`pkg-ui`) whose root is this package.

## Install (into another project)

```bash
npm i github:Markbase-Team/Markbase#pkg-ui
```

This package ships **TypeScript source**, so the consuming app must transpile it
and let Tailwind scan it.

**1. Next.js** — `next.config.ts`:

```ts
const nextConfig = {
  transpilePackages: ["@markbase/ui"],
};
```

**2. Tailwind v4** — in your global CSS, scan the package so its classes are
generated, and keep the shadcn design tokens (it relies on `--primary`,
`--border`, `--popover`, … and `@tailwindcss/typography` for `Markdown`):

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";
@source "../../node_modules/@markbase/ui/src";
```

Peers: `react` / `react-dom` 19.

## Use

```tsx
import { Button } from "@markbase/ui/button";
import { Kanban, type KanbanChange } from "@markbase/ui/kanban";
import { Markdown } from "@markbase/ui/markdown";
```

### `Kanban`

Generic, controlled-ish board. You own the data; it owns the drag interactions.

```tsx
<Kanban
  columns={[{ id, header, accent, emptyLabel }, ...]}
  items={items}                       // T extends { id: string }
  getColumnId={(item) => item.columnId}
  renderCard={(item) => <Card ... />}
  onChange={({ itemId, from, to, moved, columns }) => {
    // persist: `moved` => item changed columns; `columns` = new id order per column
  }}
/>
```

## Releasing

Just merge to `main`. The `release-packages` GitHub Action regenerates the
`pkg-ui` branch automatically (`git subtree split`).
