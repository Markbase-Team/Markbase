// The browser half of the unsubscribe agent: drive a real (headless) browser
// to an unsubscribe page and click through the confirmation, the way a person
// would. Playwright is imported lazily through a non-literal specifier so the
// bundler leaves it alone and the package stays usable when it isn't installed
// — callers get { available: false } and fall back to a manual link.

// ── Minimal Playwright surface (only what we touch) ────────────────────────
type WaitUntil = "load" | "domcontentloaded" | "networkidle";

interface PwPage {
  goto(
    url: string,
    opts?: { waitUntil?: WaitUntil; timeout?: number }
  ): Promise<void>;
  evaluate<R>(pageFunction: () => R): Promise<R>;
  waitForTimeout(ms: number): Promise<void>;
  url(): string;
}

interface PwContext {
  newPage(): Promise<PwPage>;
}

interface PwBrowser {
  newContext(opts?: { userAgent?: string }): Promise<PwContext>;
  close(): Promise<void>;
}

interface PwBrowserType {
  launch(opts?: { headless?: boolean; args?: string[] }): Promise<PwBrowser>;
}

interface PwModule {
  chromium?: PwBrowserType;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Try playwright, then playwright-core. The specifier is held in a variable so
// neither the TS resolver nor the bundler tries to follow it at build time.
async function loadChromium(): Promise<PwBrowserType | null> {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      const specifier = name;
      const mod = (await import(specifier)) as PwModule;
      if (mod.chromium) return mod.chromium;
    } catch {
      // Not installed — try the next, then give up (caller degrades to manual).
    }
  }
  return null;
}

// Runs inside the page. Looks for a "you're unsubscribed" confirmation; if not
// there yet, finds and clicks the most likely unsubscribe/confirm control.
function inspectAndAct(): { done: boolean; clicked: string | null } {
  const SUCCESS =
    /unsubscrib(ed|e was successful)|you (have|'ve) been (unsubscribed|removed)|no longer (receive|be subscribed)|successfully (unsubscribed|removed)|preferences (have been )?(updated|saved)|opted out/i;
  const ACTION =
    /unsubscribe|confirm|^yes\b|opt[\s-]?out|one[\s-]?click|remove me|continue/i;

  const text = document.body ? document.body.innerText : "";
  if (SUCCESS.test(text)) return { done: true, clicked: null };

  const nodes = document.querySelectorAll<HTMLElement>(
    "button, input[type=submit], input[type=button], a, [role=button]"
  );
  for (const el of Array.from(nodes)) {
    const value = el instanceof HTMLInputElement ? el.value : "";
    const label = (
      el.innerText ||
      value ||
      el.getAttribute("aria-label") ||
      ""
    ).trim();
    if (label && ACTION.test(label)) {
      el.click();
      return { done: false, clicked: label.slice(0, 80) };
    }
  }
  return { done: false, clicked: null };
}

export type DriveResult = {
  available: boolean; // was a browser runtime usable?
  ok: boolean; // did we observe a confirmation?
  finalUrl?: string;
  steps: string[];
};

// Open `url` and click through up to a few unsubscribe/confirm steps.
export async function driveUnsubscribe(url: string): Promise<DriveResult> {
  const chromium = await loadChromium();
  if (!chromium) return { available: false, ok: false, steps: [] };

  const steps: string[] = [];
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    steps.push(`Opened the unsubscribe page`);

    let ok = false;
    for (let step = 0; step < 4; step++) {
      const result = await page.evaluate(inspectAndAct);
      if (result.done) {
        ok = true;
        steps.push("Confirmed the unsubscribe");
        break;
      }
      if (!result.clicked) {
        steps.push("No further unsubscribe control to click");
        break;
      }
      steps.push(`Clicked “${result.clicked}”`);
      await page.waitForTimeout(1_500);
    }

    return { available: true, ok, finalUrl: page.url(), steps };
  } finally {
    await browser.close();
  }
}
