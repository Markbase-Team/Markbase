# Markbase — Mac app

A native macOS shell (Electron) around the hosted web app, so it reuses the
entire web/TypeScript codebase. The desktop app just loads the web app in a
native window.

## Run (dev)

Point it at your local web server (start `apps/web` first with `npm run dev`):

```bash
cd apps/app
npm install          # installs Electron (large, one-time)
APP_URL=http://localhost:3000 npm start
```

Without `APP_URL` it loads production (`https://markbase.so`).

## Build a .dmg

```bash
npm run dist         # outputs release/Markbase-*.dmg (mac)
```

## Smoke test: sync with nothing but the app

`scripts/sync-smoke.mjs` runs a packaged build as a fresh user — a fake `HOME`
plus `MARKBASE_USER_DATA` for Electron's own folder, so no CLI config, no
settings, no shared locks — and checks that a file in a vault folder reaches
the cloud and that an API edit comes back down to disk. It needs a TEST
account's API key: it creates a vault named "smoke …" there and deletes it
afterwards. Tickets are off for the run (`MARKBASE_TICKETS=off`).

```bash
npm run dist
MARKBASE_SMOKE_API_KEY=jsk_… node scripts/sync-smoke.mjs
```

Add `--keep` to leave the temp directories and the vault for a look. The
engine's own scenario tests live in `packages/core/vault/test`; this is the
one check that the app hosting it works end to end.

## How it works / next steps

- `src/main.ts` is the whole app: one `BrowserWindow` that `loadURL`s the web
  app; external links open in the default browser.
- This is the **fastest** desktop path — a thin wrapper. It needs the network +
  the hosted backend (Supabase), exactly like the website.
- To make it more native later: add app menus, a custom title bar, deep links,
  offline handling, or migrate the shell to **Tauri** for a ~10 MB binary.
