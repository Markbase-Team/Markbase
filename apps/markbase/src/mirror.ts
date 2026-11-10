import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { syncMirror } from "@markbase/vault";
import { DEFAULT_MIRROR_DIR, loadConfig, saveMirrorDir } from "./config";

const HELP = `Usage:
  markbase mirror [dir]   Mirror your documents to a local folder (default: ${DEFAULT_MIRROR_DIR})
  markbase mirror off     Stop mirroring (your files stay put)
  markbase mirror status  Show where the mirror is
  markbase mirror sync    Sync once now, in the foreground

Once on, the worker keeps the folder in sync both ways. Edit a file in any editor
and it lands in Markbase; edit in the browser and the file updates.
`;

// `~/Docs` -> absolute; a bare name is relative to the cwd, like every other tool.
function expand(dir: string): string {
  const home = dir.startsWith("~") ? dir.replace(/^~/, homedir()) : dir;
  return isAbsolute(home) ? home : resolve(process.cwd(), home);
}

export async function runMirror(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "--help" || sub === "-h") {
    console.log(HELP);
    return;
  }

  if (sub === "off") {
    saveMirrorDir("");
    console.log("Mirroring off. Your files are untouched.");
    return;
  }

  const cfg = loadConfig();

  if (sub === "status") {
    console.log(cfg.mirrorDir ? `Mirroring to ${cfg.mirrorDir}` : "Mirroring is off.");
    return;
  }

  if (sub === "sync") {
    if (!cfg.mirrorDir) {
      console.error("Mirroring is off. Run `markbase mirror` to turn it on.");
      process.exitCode = 1;
      return;
    }
    if (!cfg.apiKey) {
      console.error("No API key configured. Run `markbase login` first.");
      process.exitCode = 1;
      return;
    }
    await syncMirror({
      appUrl: cfg.appUrl,
      apiKey: cfg.apiKey,
      dir: cfg.mirrorDir,
      log: (m) => console.log(m),
    });
    console.log("Synced.");
    return;
  }

  // `markbase mirror [dir]` — turn it on.
  const dir = expand(sub || DEFAULT_MIRROR_DIR);
  mkdirSync(dir, { recursive: true });
  saveMirrorDir(dir);
  console.log(`Mirroring your documents to ${dir}.`);
  console.log(
    "The worker syncs both ways on its next sweep — or run `markbase mirror sync` now."
  );
  console.log(`\nTip: \`git init\` in that folder and your documents are versioned on your own disk.`);
}
