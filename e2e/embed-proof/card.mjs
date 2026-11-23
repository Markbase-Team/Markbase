// The embed through the real card (docs/embed-proof.md): the app card's own
// page, in a fake Claude, asks for a hand-off through its card-only tool (the
// real POST /api/v1/me/embed/session, with a connector's key), frames /embed
// and lands signed in. Then the person works in it: adds a to-do, ticks it,
// and a normal tab on the same document sees it ticked.
// Needs the dev server started WITHOUT MARKBASE_EMBED_PROOF (the per-request
// cookie path is what is tested) and with MARKBASE_EMBED_FRAME_ANCESTORS.
import { chromium, webkit } from "playwright";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(new URL("./local.env", import.meta.url), "utf8").trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
const EMAIL = process.env.EMBED_EMAIL ?? "connector-1122@example.com";
const DOC = process.env.EMBED_DOC ?? "0746244f-86d5-4864-917e-714302a03e54";
const KEY = env.CONNECTOR_KEY;
const APP = "https://localhost:3443";

async function magicLink() {
  const res = await fetch(`${env.API_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: { apikey: env.SERVICE_ROLE_KEY, authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: EMAIL }),
  });
  const body = await res.json();
  return body.hashed_token ?? body.properties?.hashed_token;
}

async function appFrame(page, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames().find((fr) => fr.url().startsWith(`${APP}/dashboard`) || fr.url().startsWith(`${APP}/login`));
    if (f) return f;
    await page.waitForTimeout(250);
  }
  return null;
}

async function run(name, engine) {
  const r = { variant: name, steps: {} };
  const browser = await engine.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:8766/card.html?app=${encodeURIComponent(APP)}&key=${encodeURIComponent(KEY)}&doc=${DOC}`);
    const frame = await appFrame(page);
    const proxy = page.frames().find((f) => f.url().startsWith("http://127.0.0.1:8767/host.html"));
    r.steps.handOffStatus = proxy ? await proxy.evaluate(() => window.handOffStatus ?? null) : null;
    r.steps.fullscreenRequested = proxy ? await proxy.evaluate(() => window.fullscreenRequested ?? null) : null;
    if (!frame) { r.steps.framed = false; await page.screenshot({ path: `card-${name}.png` }); return r; }
    await page.waitForTimeout(1500);
    r.steps.landedOn = new URL(frame.url()).pathname;
    r.steps.signedIn = !r.steps.landedOn.startsWith("/login");
    const editor = frame.locator(".ProseMirror").first();
    await editor.waitFor({ timeout: 60000 });
    r.steps.editorLoaded = true;
    r.cookies = (await ctx.cookies()).filter((c) => c.name.startsWith("sb-") || c.name === "mb-embed").map((c) => ({ name: c.name.replace(/-auth-token.*/, "-auth-token*"), sameSite: c.sameSite, partitioned: Boolean(c.partitionKey), httpOnly: c.httpOnly }));

    // The person works in it: a to-do at the end of the document, then ticked.
    const marker = `todo-${name}-${Date.now() % 100000}`;
    // The cursor to the very end of the document (a key for that differs by engine).
    await editor.click();
    await frame.evaluate(() => {
      const pm = document.querySelector(".ProseMirror");
      const range = document.createRange();
      range.selectNodeContents(pm.lastElementChild);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      pm.focus();
    });
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.keyboard.type(`[ ] ${marker}`, { delay: 20 });
    const item = frame.locator('ul[data-type="taskList"] > li', { hasText: marker });
    await item.waitFor({ timeout: 15000 });
    r.steps.todoCreated = true;
    await item.locator('input[type="checkbox"]').click();
    await page.waitForTimeout(500);
    r.steps.tickedInFrame = (await item.getAttribute("data-checked")) === "true";

    // A normal tab, signed in as the same person, sees it ticked.
    const other = await browser.newContext({ ignoreHTTPSErrors: true });
    const tab = await other.newPage();
    await tab.goto(`${APP}/auth/callback?token_hash=${encodeURIComponent(await magicLink())}&next=${encodeURIComponent(`/dashboard/documents/${DOC}`)}`);
    const there = tab.locator('ul[data-type="taskList"] > li', { hasText: marker });
    await there.waitFor({ timeout: 60000 });
    let seen = null;
    for (let i = 0; i < 40 && seen !== "true"; i++) { seen = await there.getAttribute("data-checked"); if (seen !== "true") await tab.waitForTimeout(500); }
    r.steps.tickedInNormalTab = seen === "true";

    // And unticking it in the tab reaches the frame live.
    await there.locator('input[type="checkbox"]').click();
    let back = null;
    for (let i = 0; i < 40 && back !== "false"; i++) { back = await item.getAttribute("data-checked"); if (back !== "false") await page.waitForTimeout(500); }
    r.steps.untickReachedFrame = back === "false";
    await other.close();
    await page.screenshot({ path: `card-${name}.png` });
    return r;
  } catch (e) {
    r.failure = String(e).split("\n")[0].slice(0, 300);
    await browser.contexts()[0]?.pages()[0]?.screenshot({ path: `card-${name}.png` }).catch(() => {});
    return r;
  } finally {
    await browser.close();
  }
}

const only = process.argv[2];
for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]].filter(([n]) => !only || n === only)) {
  console.log(JSON.stringify(await run(name, engine)));
}
