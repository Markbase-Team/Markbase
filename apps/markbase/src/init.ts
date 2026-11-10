import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { appUrl, CONFIG_PATH, loadConfig, saveConfig } from "./config";
import { runChecks } from "./doctor";
import { installServiceAfterSetup } from "./service";
import { appUrlFlag, connectInstance } from "./instance";

// Collect + verify the API key, write the config, and (if prerequisites pass)
// install the background service — unless the desktop app is installed on this
// Mac, in which case the app runs the worker and no service is set up. The app
// URL is not asked for: it is the hosted app, or the instance `--app-url` (or an
// earlier `markbase instance`) pointed this machine at.
export async function runInit(args: string[] = []): Promise<void> {
  const instance = appUrlFlag(args);
  if (instance) await connectInstance(instance);
  const existing = loadConfig();
  const base = appUrl();
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log("Set up your Markbase ticket worker.\n");

    const keyPrompt = existing.apiKey
      ? "API key [keep existing]: "
      : "API key (create one in the dashboard → API keys): ";
    const apiKey = (await rl.question(keyPrompt)).trim() || existing.apiKey;

    if (!apiKey) {
      console.error("\nNo API key provided — aborting. Create one in the dashboard and re-run `markbase init`.");
      process.exitCode = 1;
      return;
    }

    process.stdout.write("\nVerifying key… ");
    try {
      const res = await fetch(`${base}/api/v1/me`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        console.error(`failed (HTTP ${res.status}). Check the key, then re-run.`);
        process.exitCode = 1;
        return;
      }
      const data = (await res.json()) as { owner_id?: string };
      console.log(`ok — owner ${data.owner_id}`);
    } catch (e) {
      console.error(`could not reach ${base} (${String(e)}).`);
      process.exitCode = 1;
      return;
    }

    saveConfig(apiKey);
    console.log(`Saved to ${CONFIG_PATH}.`);

    // Check prerequisites, and start the background service automatically when
    // everything's ready — otherwise tell them what to fix (don't install a
    // service that would just crash-loop).
    console.log("\nChecking prerequisites…");
    const ready = await runChecks();
    if (ready) {
      await installServiceAfterSetup();
    } else {
      console.log(
        "\nFix the items above, then run `markbase install-service` to start the worker in the background."
      );
      process.exitCode = 1;
    }
  } finally {
    rl.close();
  }
}
