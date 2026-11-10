import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { awaitDeviceAuth, detectClaudeVersion } from "@markbase/node";
import {
  canOpenBrowser,
  signIn as runSignIn,
  terminalOperator,
} from "@markbase/flows/node";
import { appUrl, CONFIG_PATH, loadConfig, saveConfig } from "./config";
import { runChecks } from "./doctor";
import { installServiceAfterSetup } from "./service";
import { runSkillInstall } from "./integration/skill";
import { appUrlFlag, connectInstance } from "./instance";

// Offer to install the docs agent skill (so your coding agent — Claude Code —
// can read/write Markbase docs through the API). Independent of the worker.
async function offerSkillInstall(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const ans = (
      await rl.question(
        "\nInstall the Markbase docs skill for your coding agent (Claude Code)? [Y/n]: "
      )
    )
      .trim()
      .toLowerCase();
    if (ans === "" || ans === "y" || ans === "yes") {
      await runSkillInstall(["--global"]);
    } else {
      console.log("Skipped. Run `markbase skill install --global` anytime.");
    }
  } finally {
    rl.close();
  }
}

// Open a URL in the default browser (best-effort; we also print it).
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // ignore — the URL is printed as a fallback
  }
}

// Browser-based login: spin up a loopback server, open the web app's /cli-auth
// page, and receive the minted API key on the callback. Saves and returns it.
export async function browserLogin(): Promise<string> {
  const base = appUrl();

  // The same flow the desktop app runs. What the CLI adds is the machine check:
  // openBrowser spawns `open`/`xdg-open` and swallows the failure, and the URL
  // it prints as a fallback is no use over SSH either — opening it on YOUR
  // computer redirects to a localhost on THAT one, where nothing is listening.
  // This command would then sit on a loopback until a 30-minute backstop expired.
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const res = await runSignIn({
      operator: terminalOperator({
        ask: (prompt) => rl.question(prompt),
        write: (line) => console.log(line),
      }),
      // `markbase login` means sign in now, even if a key is already saved —
      // that is how you replace one. ensureAuthenticated does the reusing.
      readKey: () => null,
      storeKey: saveConfig,
      canOpenBrowser: canOpenBrowser(),
      keyLocation: CONFIG_PATH,
      deviceAuth: ({ open }) =>
        awaitDeviceAuth({
          appUrl: base,
          claudeVersion: detectClaudeVersion(),
          open,
        }),
      openAuthPage: (authUrl) => {
        console.log("Opening your browser to authorize this device…");
        console.log(`If it doesn't open, visit:\n  ${authUrl}\n`);
        openBrowser(authUrl);
      },
      // Running this command IS the consent; a prompt asking whether you meant
      // it would be noise. The desktop asks because sign-in there is offered,
      // not requested.
      question: { action: "Sign in to Markbase", confirmLabel: "Sign in" },
    });
    if (!res.ok) {
      // The flow has already said why, through the operator — including the
      // instruction that actually works on a machine with no browser. Repeating
      // it here in a second voice ("This machine can't open a browser.") gave
      // one decision two lines, the second less useful than the first. The
      // caller needs the throw, not another sentence, so this one is terse and
      // the operator's message is what the person reads.
      const why =
        res.reason === "no-browser"
          ? "no browser on this machine"
          : res.reason === "declined"
            ? "declined"
            : res.reason === "canceled"
              ? "canceled"
              : (res.message ?? "it failed");
      const e = new Error(`Sign-in didn't complete — ${why}.`);
      e.name = "SignInIncompleteError";
      throw e;
    }
    return finishLogin(res.key);
  } finally {
    rl.close();
  }
}

/** The part after a key arrives: say where it went, and what is still missing. */
function finishLogin(key: string): string {
  console.log(`\nConnected. Saved to ${CONFIG_PATH}.`);
  if (!detectClaudeVersion()) {
    console.log(
      "\nClaude Code wasn't found on this machine, so projects, agents, and\n" +
        "@mention replies stay locked. Install it, then re-run `markbase login`:\n" +
        "  https://claude.com/claude-code"
    );
  }
  return key;
}

// Ensure a key is available: reuse the saved one, or offer to authenticate in
// the browser right now. Returns true if a key is present afterward. Lets the
// install commands authenticate a person without a separate `markbase login`.
export async function ensureAuthenticated(): Promise<boolean> {
  if (loadConfig().apiKey) return true;

  // Checked BEFORE announcing a browser. This is how the MCP server starts, so
  // on a headless box the old order printed "opening your browser to sign in…"
  // and then waited half an hour on a loopback no browser would ever reach —
  // with Claude Code sitting there waiting for the server to come up.
  if (!canOpenBrowser()) {
    console.error(
      "\nNo API key, and this machine can't open a browser to sign in.\n" +
        "Create a key in the dashboard under API keys, then set MARKBASE_API_KEY."
    );
    return false;
  }

  // We don't prompt/guard on TTY: an installer should just open it.
  console.log("\nNo API key yet — opening your browser to sign in…");
  try {
    await browserLogin();
    return true;
  } catch (e) {
    // browserLogin's operator has already said why, and said what to do about
    // it. A second copy here made three variants of one sentence.
    console.error(
      `\nSign-in didn't complete (${e instanceof Error ? e.message : String(e)}).`
    );
    return false;
  }
}

// `markbase login` — authenticate, then offer the skill and set up the worker.
export async function runLogin(args: string[] = []): Promise<void> {
  // `--app-url` is how a team member joins a self-hosted instance: it is saved
  // first, so the browser that opens is that instance's, and the key that comes
  // back belongs to it.
  const instance = appUrlFlag(args);
  if (instance) {
    const info = await connectInstance(instance);
    console.log(`Signing in to ${appUrl()} (Supabase project ${info.supabase_url}).\n`);
  }
  await browserLogin();

  await offerSkillInstall();

  console.log("\nChecking prerequisites…");
  const ready = await runChecks();
  if (ready) {
    await installServiceAfterSetup();
  } else {
    console.log(
      "\nFix the items above, then run `markbase install-service` to start the worker."
    );
    process.exitCode = 1;
  }
}
