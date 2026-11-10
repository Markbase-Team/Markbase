#!/usr/bin/env node
// Does vault sync work on a Mac that has nothing but the app?
//
// The engine has its own tests (packages/core/vault/test), but they fake the
// transport and never run the app around it. This runs a PACKAGED build the way
// a fresh user would see it — no CLI, no ~/.markbaseConfig, no settings.json —
// and checks the two directions through the HTTP API:
//
//   1. a markdown file in the vault folder becomes a document in the cloud;
//   2. an edit made through the API lands in that file on disk.
//
// "Fresh user" is a fake HOME (the registry, the locks, ~/Markbase and the
// launch agent all resolve from it) plus MARKBASE_USER_DATA for the one path
// Electron resolves from the OS instead (settings, logs, the single-instance
// lock). MARKBASE_TICKETS=off keeps the run from claiming the account's
// tickets. It is a real app against a real account: give it a TEST account's
// key — it creates a vault named "smoke …" there and deletes it at the end.
//
//   MARKBASE_SMOKE_API_KEY=jsk_… node scripts/sync-smoke.mjs [--keep]
//
//   MARKBASE_SMOKE_APP   the .app to run (default: release/mac-arm64/Markbase.app,
//                        then /Applications/Markbase.app)
//   APP_URL              the API (default https://markbase.so)
//   --keep               leave the temp directories and the vault for a look
//
// Exit 0 on pass, 1 on fail, with the app's vault.log tail on a failure.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const keep = process.argv.includes("--keep");
const POLL_MS = 2_000;
const UP_TIMEOUT_MS = 120_000;
const DOWN_TIMEOUT_MS = 120_000;

const t0 = Date.now();
const say = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const apiKey = process.env.MARKBASE_SMOKE_API_KEY;
if (!apiKey) {
  console.error("Set MARKBASE_SMOKE_API_KEY to an API key of a TEST account (a vault is created and deleted there).");
  process.exit(2);
}
const appUrl = (process.env.APP_URL ?? "https://markbase.so").replace(/\/$/, "");
const appBundle =
  process.env.MARKBASE_SMOKE_APP ??
  [
    join(here, "..", "release", "mac-arm64", "Markbase.app"),
    join(here, "..", "release", "mac", "Markbase.app"),
    "/Applications/Markbase.app",
  ].find(existsSync);
const bin = appBundle && join(appBundle, "Contents", "MacOS", "Markbase");
if (!bin || !existsSync(bin)) {
  console.error("No packaged app found. `npm run dist` first, or set MARKBASE_SMOKE_APP=/path/to/Markbase.app.");
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${appUrl}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/** Poll `probe` until it returns a value, or give up. */
async function until(what, timeoutMs, probe) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await probe();
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
    await sleep(POLL_MS);
  }
}

// ---- the fresh user ------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "markbase-smoke-"));
const home = join(root, "home");
const userData = join(root, "userdata");
const vaultName = `smoke ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
const vaultDir = join(home, "Markbase", "Smoke");
const nonceUp = randomBytes(4).toString("hex");
const nonceDown = randomBytes(4).toString("hex");

let vaultId = null;
let app = null;
let passed = false;

function tail(path, lines = 25) {
  try {
    return readFileSync(path, "utf8").trim().split("\n").slice(-lines).join("\n");
  } catch {
    return "(no file)";
  }
}

async function stopApp() {
  if (!app || app.exitCode !== null) return;
  say("stopping the app (SIGTERM)");
  const exited = new Promise((r) => app.once("exit", r));
  app.kill("SIGTERM");
  const code = await Promise.race([exited, sleep(10_000).then(() => "timeout")]);
  if (code === "timeout") {
    say("app did not exit in 10s — SIGKILL");
    app.kill("SIGKILL");
    await exited;
  } else say(`app exited (${code})`);
}

async function cleanup() {
  await stopApp();
  if (keep) {
    say(`--keep: temp root ${root}; vault "${vaultName}" (${vaultId}) left in the account`);
    return;
  }
  if (vaultId) {
    try {
      await api("DELETE", `/vaults/${vaultId}`);
      say(`deleted vault "${vaultName}" from the cloud`);
    } catch (e) {
      say(`couldn't delete the smoke vault ${vaultId}: ${e.message} — delete it by hand`);
    }
  }
  rmSync(root, { recursive: true, force: true });
}

try {
  say(`app: ${appBundle}`);
  say(`api: ${appUrl}`);
  say(`fresh home: ${root}`);

  // 1. A vault in the cloud, and the files a fresh user would have on disk if
  //    they had just signed in and mounted it.
  const { vault } = await api("POST", "/vaults", { name: vaultName });
  vaultId = vault.id;
  say(`created vault "${vaultName}" (${vaultId})`);

  mkdirSync(join(vaultDir, ".markbase"), { recursive: true });
  writeFileSync(join(vaultDir, ".markbase", "vault.json"), JSON.stringify({ vaultId }, null, 2));
  writeFileSync(join(vaultDir, "hello.md"), `# Smoke\n\nup ${nonceUp}\n`);
  mkdirSync(join(home, ".markbaseConfig"), { recursive: true });
  writeFileSync(
    join(home, ".markbaseConfig", "config.json"),
    JSON.stringify({ vaults: [{ vaultId, name: vaultName, dir: vaultDir }] }, null, 2)
  );
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, "settings.json"),
    JSON.stringify(
      {
        apiKey,
        // Not on this machine's login items: the agent would point at this build.
        startAtLogin: false,
        // No first-mount dialog: the vault above is the mount.
        firstMountPromptedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );

  // 2. The app, as launchd would start it: no window, menu bar only.
  const env = { ...process.env, HOME: home, MARKBASE_USER_DATA: userData, MARKBASE_TICKETS: "off", APP_URL: appUrl };
  delete env.MARKBASE_HOME; // would override the fresh home's registry
  delete env.MARKBASE_API_KEY;
  const appLog = join(root, "app.log");
  app = spawn(bin, ["--at-login"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const out = [];
  app.stdout.on("data", (d) => out.push(d));
  app.stderr.on("data", (d) => out.push(d));
  app.on("exit", () => writeFileSync(appLog, Buffer.concat(out)));
  say(`started ${bin} (pid ${app.pid})`);

  // 3. Up: the file becomes a document.
  const doc = await until("hello.md to appear as a document in the cloud", UP_TIMEOUT_MS, async () => {
    if (app.exitCode !== null) throw new Error(`the app exited early (${app.exitCode})`);
    const { docs } = await api("GET", `/docs?vault=${vaultId}&content=1`);
    return (docs ?? []).find((d) => d.path === "hello.md" && (d.content ?? "").includes(nonceUp));
  });
  say(`up: hello.md is document ${doc.id} with the on-disk content`);

  // 4. Down: an edit through the API lands in the file.
  await api("POST", `/docs/${doc.id}/edits`, { quote: `up ${nonceUp}`, insert: `down ${nonceDown}` });
  say("edited the document through the API");
  await until("the edit to land in hello.md on disk", DOWN_TIMEOUT_MS, async () => {
    if (app.exitCode !== null) throw new Error(`the app exited early (${app.exitCode})`);
    return readFileSync(join(vaultDir, "hello.md"), "utf8").includes(nonceDown);
  });
  say("down: hello.md on disk has the edit");

  passed = true;
} catch (e) {
  say(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  console.log(`\n--- ${join(userData, "vault.log")} (tail)\n${tail(join(userData, "vault.log"))}`);
  console.log(`\n--- app stdout/stderr (tail)\n${tail(join(root, "app.log"))}`);
} finally {
  await cleanup();
}

say(passed ? "PASS — sync works with nothing but the app" : "FAIL");
process.exit(passed ? 0 : 1);
