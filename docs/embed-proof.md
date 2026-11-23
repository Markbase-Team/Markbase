# Embed proof: the real Markbase app inside a Claude card

**Question.** Can the full Markbase web app run full page inside an MCP App card in Claude, with the person signed in, the document in the real editor, and live co-editing? This is Phase 2 of the MCP Apps hand-off.

**Answer so far.** Yes in Chromium and WebKit, against a local stand-in for Claude, through the same card, tools and routes Claude will use. The person can work in it: type, add a to-do and tick it, and the change reaches a normal tab live. One condition on Claude's side can only be confirmed by a test inside Claude (below). Firefox could not be launched on the test machine.

## Scope: the document, in two views

1. **Inline, in the conversation:** the document card as before: the title, the rendered text, "Open in Markbase". No sign-in. With the embed on, it also has **"Open full page"**.
2. **Full page, in the side panel:** the real web app at that document, in **embed mode**. The documents surface is all there, with editing on: the files list (the vault's tree), the editor, comments, history, Share and Publish.
   - Hidden: what is outside the documents surface. That is the app's nav rail (other features, settings), the account menu, the desktop app's download prompts, and the "Connect an agent" dialog (the person is in their agent already).
   - Also hidden: **Download**. A framed page cannot be relied on to save a file (see below), so the owner chose to drop it.
   - Embed mode is on when the request carries the frame's marker cookie, which only the embed frame has. `?embed=1` also turns it on in the browser.
   - The switch is `EmbedModeProvider` / `useEmbedMode()` in the documents feature (`packages/features/docs/src/ui/embed-mode.tsx`), and `lib/embed-mode.ts` in the web app.

## How it works

1. Either the person presses **"Open full page"** on a document card, or the agent calls **`me_openApp`** (`GET /api/v1/me/embed/app?doc=<id>`) and Claude draws the **app card** (`ui://markbase/app`, `packages/shared/src/docs/apps/app-app.ts`). Both frame the app the same way.
2. The card asks to go full page (`ui/request-display-mode`). In Claude that is the panel beside the conversation.
3. The card calls **`me_embedSession`** through the host (`POST /api/v1/me/embed/session`), with the connector's key. The tool is listed for the card only (`_meta.ui.visibility: ["app"]`), so its answer never reaches the model. The answer is `https://<instance>/embed?code=…`. The code is a Supabase magic-link token (single use) sealed with the account and the document. It opens for 60 seconds (`sealEmbedCode` in `packages/platform/server/src/mcp-oauth.ts`). Only a connector's key may ask; a browser session is refused.
4. The card frames that address. **`/embed`** opens the code, turns the token into a session and checks it is the right account, then redirects to the document with `?embed=1`.
   - The session cookies are `SameSite=None; Secure; Partitioned` (CHIPS). They live in that frame, under the site that framed it, apart from the person's own markbase.so session.
   - A marker cookie, `mb-embed` (partitioned, httpOnly), tells the server to keep writing cookies that way for requests from that frame (`packages/shared/src/embed-cookies.ts`).
   - The browser client uses the same cookies whenever it is in another site's frame.
5. The app runs as it does anywhere else: the editor, comments, history, and live co-editing over Supabase Realtime.

## The flag

All of it is off unless **`MARKBASE_EMBED_FRAME_ANCESTORS`** is set: the sites allowed to frame the app, for Claude `https://claude.ai https://*.claudemcpcontent.com`. Unset, as in production today:

- `X-Frame-Options: SAMEORIGIN` stays as it is.
- `/embed` and `/api/v1/me/embed/*` answer 404.
- The MCP server offers neither the two tools nor the app card.

Set, `X-Frame-Options` gives way to `Content-Security-Policy: frame-ancestors 'self' <those sites>` (`apps/web/next.config.ts`). That header is built when the app is built, so the variable must be set before the deploy.

`MARKBASE_EMBED_PROOF=1` is for the local proof only. It makes the server write embed cookies for every request, and is never set anywhere real.

## What was tested

A fake Claude nests frames the way an MCP Apps host does:

```
http://127.0.0.1:8766  top level ("claude.ai")
  └ http://127.0.0.1:8767  sandbox proxy (another origin), acting as the host
      └ the app card (srcdoc, sandboxed)
          └ https://localhost:3443/embed?code=…  →  Markbase, full page
```

Markbase and local Supabase run behind HTTPS, so cookies behave as they do in production.

- **`e2e/embed-proof/card.mjs`** uses the real path, with the flag set and `MARKBASE_EMBED_PROOF` off. The host loads the real app card. It answers the card's `me_embedSession` call by calling the real endpoint with a real connector key. Then the person works in the framed app: adds a to-do and ticks it. A normal tab, signed in as the same person, must see it ticked, and unticking it there must reach the frame.
- **`e2e/embed-proof/run.mjs`** is the first, lower-level proof. It frames the app through a sign-in link minted with the admin API, and checks a reload and two-way typing.

## Results (2026-11-22)

Real card path (`card.mjs`), app card:

| Browser | Hand-off | Full page asked | Signed in | Editor | To-do added | Ticked in frame | Seen ticked in tab | Untick reached frame |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Chromium (Chrome, Edge) | 200 | yes | yes | yes | yes | yes | yes | yes |
| WebKit (Safari) | 200 | yes | yes | yes | yes | yes | yes | yes |

Document card, "Open full page" pressed: Chromium and WebKit both got the hand-off (200), asked for full page and landed signed in on the document with the editor loaded.

Embed mode, on both cards and in both browsers:
- **Present:** the files list, the editor, Share, Comments and History.
- **Gone:** Download, the app's nav rail and the account menu.

**Download inside the frame** (tested before it was removed):

| Browser | Card sandbox without `allow-downloads` | With `allow-downloads` | Same app, not framed |
| --- | --- | --- | --- |
| WebKit (Safari) | blocked ("Not allowed to download due to sandboxing") | the `.md` file arrives | — |
| Chromium (Chrome, Edge) | no file, no message | no file, no message | the `.md` file arrives |

So Download would work inside Claude only in Safari, and only if Claude's card sandbox includes `allow-downloads`. In Chrome it does not work framed. Embed mode therefore leaves Download out. Bringing it back would need a way that does not depend on the frame, for example a short-lived download link opened in a new tab.

Lower-level proof (`run.mjs`):

| Browser | Signed in | After reload | Editor | Frame → tab | Tab → frame | Session stays in frame |
| --- | --- | --- | --- | --- | --- | --- |
| Chromium | yes | yes | yes | yes | yes | yes |
| Chromium, third-party cookies blocked | yes | yes | yes | yes | yes | yes |
| WebKit | yes | yes | yes | yes | yes | yes |
| Firefox | not run: Playwright's Firefox would not launch on this macOS | | | | | |
| Card sandbox **without** `allow-same-origin` | no: the frame is refused | | | | | |

"Session stays in frame" means a normal tab in the same browser is not signed in by the frame's session.

## The condition only Claude can answer

`frame-ancestors` checks **every** ancestor, and so does cookie access. If Claude sandboxes the card's frame **without** `allow-same-origin`:

- The card's origin is opaque, so no `frame-ancestors` value can name it, and Markbase is refused.
- Even if it were framed, the nested Markbase frame would inherit the sandbox. It would have no cookies and no storage.

The MCP Apps spec says a web host's sandbox proxy has `allow-scripts allow-same-origin`. It does not say what the card frame inside the proxy gets. This is what the test in Claude answers.

## Testing it in Claude

1. Set `MARKBASE_EMBED_FRAME_ANCESTORS=https://claude.ai https://*.claudemcpcontent.com` on the deployment, then deploy.
2. In Claude, disconnect the Markbase connector and connect it again, so Claude reads the new tool list.
3. Ask Claude to open a document in Markbase. It should call `me_openApp`, and the panel should show the app, signed in.
4. If the panel stays blank, the browser console names the refusal. A `frame-ancestors` error that names `null` is the sandbox condition above.

To switch it off, unset the variable and deploy.

## Still open

- **Security review of the hand-off.** It grants a real session for a minute, once. It is never logged, it is only for a connector's key, and its answer is card-only. It still needs a second look before it is more than an experiment.
- **The exact frame-ancestors.** Claude may assign a fixed card domain (`_meta.ui.domain`). If so, name it instead of the wildcard.
- **Server-side session refresh in the frame.** The browser client refreshes the session itself. A refresh that happens on the server writes embed cookies only because of the marker; a frame open for more than an hour is untested.
- **Firefox**, on a machine where it launches.

## Running it again

The local Supabase stack must be up. In `e2e/embed-proof`:

```bash
npm init -y && npm install playwright@1.62.1 && npx playwright install chromium webkit firefox
```

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 7 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

From the repo root, write the card's page for the local instance:

```bash
npx tsx e2e/embed-proof/gen-card.ts
```

In `e2e/embed-proof`, start the HTTPS proxy and the two fake-Claude pages:

```bash
node tls-proxy.mjs & (cd host && python3 -m http.server 8766) & (cd proxy && python3 -m http.server 8767) &
```

Start the web app with the flag, pointed at local Supabase through the proxy. Add `MARKBASE_EMBED_PROOF=1` for `run.mjs`; leave it out for `card.mjs`.

```bash
eval "$(npx supabase@2 status -o env)" && cd apps/web && SUPABASE_URL=https://localhost:54443 NEXT_PUBLIC_SUPABASE_URL=https://localhost:54443 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY SUPABASE_KEY=$SERVICE_ROLE_KEY SUPABASE_SECRET_KEY=$SERVICE_ROLE_KEY NODE_TLS_REJECT_UNAUTHORIZED=0 MARKBASE_EMBED_FRAME_ANCESTORS="http://127.0.0.1:8766 http://127.0.0.1:8767" APP_URL=https://localhost:3443 npm run dev -- -p 3012
```

Write `local.env` in `e2e/embed-proof`:
- `SERVICE_ROLE_KEY` and `API_URL` from `supabase status`;
- for `card.mjs`, also `CONNECTOR_KEY`, a connector API key for the test account.

Set `EMBED_EMAIL` and `EMBED_DOC` to a local account and one of its documents. Then run `node card.mjs` or `node run.mjs`; either takes a browser name to run one.
