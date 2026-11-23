// The embed proof: Markbase's real web app, framed full page inside a card in
// a fake Claude (top-level site 127.0.0.1:8766 → sandbox proxy 127.0.0.1:8767
// → card srcdoc → https://localhost:3443), signed in with a one-time hand-off
// token. For each browser engine it checks what the owner asked:
//   1. does sign-in stick inside the frame (and survive a reload)?
//   2. does the document load in the real editor?
//   3. does co-editing connect (an edit in the frame reaches a normal tab, and back)?
// plus: the embedded session stays inside the frame (a normal tab is not signed in by it).
import { chromium, webkit, firefox } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(new URL("./local.env", import.meta.url), "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
// A local test account and one of its documents (docs/embed-proof.md).
const EMAIL = process.env.EMBED_EMAIL ?? "connector-1122@example.com";
const DOC = process.env.EMBED_DOC ?? "0746244f-86d5-4864-917e-714302a03e54";
const APP = "https://localhost:3443";
const DOC_PATH = `/dashboard/documents/${DOC}`;

async function handOffToken() {
  const res = await fetch(`${env.API_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: env.SERVICE_ROLE_KEY, authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL }),
  });
  const body = await res.json();
  const token = body.hashed_token ?? body.properties?.hashed_token;
  if (!token) throw new Error(`no token: ${JSON.stringify(body).slice(0, 200)}`);
  return token;
}

const handOffUrl = (token) => `${APP}/auth/callback?token_hash=${encodeURIComponent(token)}&next=${encodeURIComponent(DOC_PATH)}`;

async function appFrame(page, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames().find((fr) => fr.url().startsWith(APP) && !fr.url().includes("/auth/callback"));
    if (f) return f;
    await page.waitForTimeout(250);
  }
  return null;
}

async function editorIn(target, timeout = 60000) {
  try {
    await target.locator(".ProseMirror").first().waitFor({ state: "visible", timeout });
    await target.getByText("Welcome to Markbase", { exact: false }).first().waitFor({ timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function typeIn(target, page, text) {
  const editor = target.locator(".ProseMirror").first();
  await editor.click({ position: { x: 40, y: 12 } });
  await page.keyboard.type(text, { delay: 15 });
}

async function waitForText(target, text, timeout = 20000) {
  try {
    await target.locator(".ProseMirror").first().getByText(text, { exact: false }).waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

const sbCookies = (cookies) =>
  cookies.filter((c) => c.name.startsWith("sb-")).map((c) => ({ name: c.name.replace(/-auth-token.*/, "-auth-token*"), sameSite: c.sameSite, secure: c.secure, partitionKey: c.partitionKey ?? null }));

async function variant(name, engine, launch, sandbox) {
  const r = { variant: name, sandbox, steps: {} };
  const browser = await engine.launch(launch);
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    const host = `http://127.0.0.1:8766/index.html?sandbox=${encodeURIComponent(sandbox)}&app=${encodeURIComponent(handOffUrl(await handOffToken()))}`;
    await page.goto(host);

    // 1 + 2: signed in, on the document, in the real editor
    const frame = await appFrame(page);
    if (!frame) {
      r.steps.framed = "no Markbase frame loaded (blocked from framing?)";
      r.errors = errors.slice(0, 6);
      await page.screenshot({ path: `shot-${name}.png` });
      return r;
    }
    await frame.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1500);
    r.steps.landedOn = new URL(frame.url()).pathname;
    r.steps.signedInInFrame = !new URL(frame.url()).pathname.startsWith("/login");
    r.steps.editorLoaded = r.steps.signedInInFrame ? await editorIn(frame) : false;
    r.cookies = sbCookies(await ctx.cookies());

    // 1b: the session survives a reload of the frame (no token this time)
    await frame.goto(`${APP}${DOC_PATH}`).catch(() => {});
    const again = (await appFrame(page)) ?? frame;
    await page.waitForTimeout(1500);
    r.steps.signedInAfterReload = !new URL(again.url()).pathname.startsWith("/login");
    const embedded = again;
    if (r.steps.signedInAfterReload) await editorIn(embedded, 30000);

    // isolation: a normal tab in the same browser is NOT signed in by the embed's session
    const tab = await ctx.newPage();
    await tab.goto(`${APP}${DOC_PATH}`).catch(() => {});
    await tab.waitForTimeout(1500);
    r.steps.topLevelTabSignedInByEmbed = !new URL(tab.url()).pathname.startsWith("/login");
    await tab.close();

    // 3: co-editing — a second browser profile signed in top level on the same document
    if (r.steps.editorLoaded && r.steps.signedInAfterReload) {
      const other = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 } });
      const top = await other.newPage();
      await top.goto(handOffUrl(await handOffToken()));
      const topReady = await editorIn(top);
      r.steps.topLevelEditorLoaded = topReady;
      if (topReady) {
        await page.waitForTimeout(2000);
        const m1 = `frame-${name}-${Date.now() % 100000}`;
        await typeIn(embedded, page, ` ${m1} `);
        r.steps.frameEditReachedTopLevel = await waitForText(top, m1);
        const m2 = `top-${name}-${Date.now() % 100000}`;
        await typeIn(top, top, ` ${m2} `);
        r.steps.topLevelEditReachedFrame = await waitForText(embedded, m2);
      }
      await other.close();
    }
    await page.screenshot({ path: `shot-${name}.png` });
    r.errors = errors.filter((e) => !/webpack-hmr|Download the React DevTools|favicon/.test(e)).slice(0, 6);
    return r;
  } catch (e) {
    r.failure = String(e).slice(0, 300);
    return r;
  } finally {
    await browser.close();
  }
}

const SAME_ORIGIN = "allow-scripts allow-same-origin allow-forms allow-popups";
const OPAQUE = "allow-scripts allow-forms allow-popups";
const only = process.argv[2];
const plan = [
  ["chromium", chromium, { headless: true }, SAME_ORIGIN],
  ["chromium-3p-cookies-blocked", chromium, { headless: true, args: ["--test-third-party-cookie-phaseout"] }, SAME_ORIGIN],
  ["webkit", webkit, { headless: true }, SAME_ORIGIN],
  ["firefox", firefox, { headless: true, timeout: 60000 }, SAME_ORIGIN],
  ["chromium-card-without-same-origin", chromium, { headless: true }, OPAQUE],
].filter(([n]) => !only || n === only);

const results = [];
for (const [name, engine, launch, sandbox] of plan) {
  const r = await variant(name, engine, launch, sandbox);
  console.log(JSON.stringify(r));
  results.push(r);
}
writeFileSync("results.json", JSON.stringify(results, null, 2));
