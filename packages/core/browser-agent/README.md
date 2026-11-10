# @markbase/browser-agent

An agent that unsubscribes from an email for you. Given the unsubscribe targets
extracted from a message, it picks the best strategy:

1. **One-click (RFC 8058)** — a single `POST List-Unsubscribe=One-Click` to the
   `List-Unsubscribe` URL. No browser; covers most modern bulk senders.
2. **Browser agent** — launches a headless Chromium (Playwright), opens the
   unsubscribe page, and clicks through the confirmation the way a person would.
3. **mailto** — reports that the sender only accepts unsubscribe-by-email.

```ts
import { runUnsubscribe } from "@markbase/browser-agent";

const result = await runUnsubscribe({
  httpUrl: "https://news.example.com/u?id=abc",
  oneClick: true,
  mailto: null,
  bodyUrl: null,
});
// → { ok: true, method: "one-click", message: "Unsubscribed — …" }
```

## Enabling the live browser agent

Playwright is loaded lazily and is **not** a hard dependency, so this package
installs everywhere and the one-click path always works. To exercise the
browser-driven path (step 2), install Playwright + a browser in the runtime:

```sh
npm i -D playwright
npx playwright install chromium
```

When Playwright/Chromium isn't present, the browser path degrades gracefully:
`runUnsubscribe` returns `{ ok: false, method: "browser", manualUrl }` so the UI
can offer to open the unsubscribe page by hand.
