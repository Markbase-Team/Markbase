# Embed proof: the real Markbase app inside a Claude card

**Question.** Can the full Markbase web app run full page inside an MCP App card in Claude, with the person signed in, the document in the real editor, and live co-editing? This is Phase 2 of the MCP Apps hand-off.

**Answer so far.** Yes in Chromium and WebKit, against a local stand-in for Claude. One condition on Claude's side can only be confirmed by a test inside Claude (below). Firefox could not be launched on the test machine.

## What was tested

A fake Claude nests frames the way an MCP Apps host does:

```
http://127.0.0.1:8766  top level ("claude.ai")
  └ http://127.0.0.1:8767  sandbox proxy (another origin)
      └ card (srcdoc, sandboxed)
          └ https://localhost:3443  Markbase, full page
```

The card frames Markbase at `/auth/callback?token_hash=<one-time token>&next=/dashboard/documents/<id>`. That is the hand-off in its eventual shape: a single-use, short-lived sign-in token minted for the connector's user (here with the Supabase admin API). Markbase and local Supabase run behind HTTPS, so cookies behave as they do in production.

For each browser, `e2e/embed-proof/run.mjs` checks:

1. Signed in inside the frame, and still signed in after the frame reloads without the token.
2. The document opens in the real editor.
3. An edit typed in the frame shows up in a normal tab on the same document, and the other way round.
4. A normal tab in the same browser is **not** signed in by the frame's session.

## Results (2026-11-22)

| Browser | Signed in | After reload | Editor | Frame → tab | Tab → frame | Session stays in frame |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium (Chrome, Edge) | yes | yes | yes | yes | yes | yes |
| Chromium, third-party cookies blocked | yes | yes | yes | yes | yes | yes |
| WebKit (Safari) | yes | yes | yes | yes | yes | yes |
| Firefox | not run: Playwright's Firefox would not launch on this macOS | | | | | |
| Card sandbox **without** `allow-same-origin` | no: the frame is refused | | | | | |

In every passing browser the session cookie came back as `SameSite=None; Secure`, partitioned under the top-level site (`partitionKey: http://127.0.0.1`).

## What made it work

Two changes, both behind a flag (`MARKBASE_EMBED_PROOF=1`) and off in production:

- **Session cookies a framed page may keep.** `SameSite=None; Secure; Partitioned` (CHIPS), set by the server while the flag is on and by the browser client whenever it is in another site's frame (`packages/shared/src/embed-cookies.ts`). Partitioned means the cookie belongs to that one top-level site. Claude's frame gets its own session, separate from the person's markbase.so session, and no other site can see it.
- **Framing allowed for named origins only.** `X-Frame-Options: SAMEORIGIN` is replaced by `Content-Security-Policy: frame-ancestors 'self' <origins>` when `MARKBASE_EMBED_FRAME_ANCESTORS` is set (`apps/web/next.config.ts`).

## The condition only Claude can answer

`frame-ancestors` checks **every** ancestor, and so does cookie access. If Claude sandboxes the card's frame **without** `allow-same-origin`:

- The card's origin is opaque, so no `frame-ancestors` value can name it, and Markbase is refused.
- Even if it were framed, the nested Markbase frame would inherit the sandbox. It would have no cookies and no storage.

The MCP Apps spec says a web host's sandbox proxy has `allow-scripts allow-same-origin`. It does not say what the card frame inside the proxy gets. The next test has to run in Claude itself.

## Before this could ship

- **Hand-off tool.** An MCP tool that returns a single-use token for the connector's user (about 60 seconds, never logged), and an `/embed` route that redeems it. The proof used the admin API directly.
- **Frame-ancestors.** `'self' https://*.claudemcpcontent.com`, or the exact `_meta.ui.domain` Claude assigns. Never `*`.
- **Cookie scope.** The browser client already writes partitioned cookies only when framed. The server should do the same, keyed on the request being an embed, rather than on a global flag, so the person's top-level session keeps `SameSite=Lax`.
- **Card.** A full-page card that requests `fullscreen`, lists the instance in `_meta.ui.csp.frameDomains`, and frames `/embed`.
- **Security review** of the hand-off token.

## Running it again

The local Supabase stack must be up. In `e2e/embed-proof`:

```bash
npm init -y && npm install playwright@1.62.1 && npx playwright install chromium webkit firefox
```

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 7 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Start the HTTPS proxy (`https://localhost:3443` to the app on 3012, `https://localhost:54443` to Supabase on 54321) and the two fake-Claude pages:

```bash
node tls-proxy.mjs & (cd host && python3 -m http.server 8766) & (cd proxy && python3 -m http.server 8767) &
```

Start the web app with the flag, pointed at local Supabase through the proxy (from the repo root):

```bash
eval "$(npx supabase@2 status -o env)" && cd apps/web && SUPABASE_URL=https://localhost:54443 NEXT_PUBLIC_SUPABASE_URL=https://localhost:54443 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY SUPABASE_KEY=$SERVICE_ROLE_KEY SUPABASE_SECRET_KEY=$SERVICE_ROLE_KEY NODE_TLS_REJECT_UNAUTHORIZED=0 MARKBASE_EMBED_PROOF=1 MARKBASE_EMBED_FRAME_ANCESTORS="http://127.0.0.1:8766 http://127.0.0.1:8767" APP_URL=https://localhost:3443 npm run dev -- -p 3012
```

Write `local.env` in `e2e/embed-proof` with `SERVICE_ROLE_KEY` and `API_URL` from `supabase status`. Set `EMBED_EMAIL` and `EMBED_DOC` to a local account and one of its documents. Then run `node run.mjs`, or `node run.mjs webkit` for one browser.
