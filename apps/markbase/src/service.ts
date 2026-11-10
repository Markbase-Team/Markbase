import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { DESKTOP_APP_NOTE, detectDesktopApp } from "./desktop-app";

const exec = promisify(execFile);

const LABEL = "com.markbase.cli";
// Run the worker via the same node + cli.js that launched this command, with
// the `start` subcommand. Absolute paths so it works regardless of PATH.
const NODE = process.execPath;
const CLI = process.argv[1];
const LOG = join(homedir(), "Library", "Logs", "markbase.log");

const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const SYSTEMD_PATH = join(homedir(), ".config", "systemd", "user", "markbase.service");

// launchd/systemd give a service a minimal PATH that omits Homebrew, nvm, etc.
// — so a spawned `claude`/`git`/`gh` would fail with ENOENT. Capture the PATH
// from the (interactive) shell that ran `install-service`, where those tools
// resolve, and bake it into the unit.
const SERVICE_PATH = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
const HOME = homedir();

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

async function installLaunchd(): Promise<void> {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${CLI}</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEscape(SERVICE_PATH)}</string>
    <key>HOME</key><string>${xmlEscape(HOME)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
`;
  write(PLIST_PATH, plist);
  await exec("launchctl", ["unload", "-w", PLIST_PATH]).catch(() => {});
  await exec("launchctl", ["load", "-w", PLIST_PATH]);
  console.log(`Installed launchd service "${LABEL}".`);
  console.log(`  Logs:    ${LOG}`);
  console.log(`  Stop:    markbase uninstall-service`);
}

async function installSystemd(): Promise<void> {
  const unit = `[Unit]
Description=Markbase ticket worker
After=network-online.target

[Service]
ExecStart=${NODE} ${CLI} start
Environment=PATH=${SERVICE_PATH}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
  write(SYSTEMD_PATH, unit);
  await exec("systemctl", ["--user", "daemon-reload"]);
  await exec("systemctl", ["--user", "enable", "--now", "markbase.service"]);
  console.log('Installed systemd user service "markbase".');
  console.log("  Logs:  journalctl --user -u markbase -f");
  console.log("  Stop:  markbase uninstall-service");
}

/** Is a background service currently installed for this user? */
export function serviceInstalled(): boolean {
  if (process.platform === "darwin") return existsSync(PLIST_PATH);
  if (process.platform === "linux") return existsSync(SYSTEMD_PATH);
  return false;
}

export async function installService(): Promise<void> {
  if (process.platform === "darwin") return installLaunchd();
  if (process.platform === "linux") return installSystemd();
  console.error(
    `Automatic service install isn't supported on ${process.platform}. Run \`markbase start\` under your own process manager.`
  );
  process.exitCode = 1;
}

// How the two entry points below reach the world — swapped out in tests.
export type ServiceDeps = {
  detectDesktopApp: () => Promise<boolean>;
  install: () => Promise<void>;
};

/**
 * The last step of `login` and `init`: get the worker running in the
 * background. On a Mac that has the desktop app, that's already the app's job,
 * so install nothing and say why — a launchd service next to the app would be
 * redundant, and "Log out" in the app wouldn't stop it.
 */
export async function installServiceAfterSetup(
  deps: ServiceDeps = { detectDesktopApp, install: installService }
): Promise<void> {
  if (await deps.detectDesktopApp()) {
    console.log(`\n${DESKTOP_APP_NOTE} Skipping it — \`markbase install-service\` installs one anyway.`);
    return;
  }
  console.log("\nAll set — installing the background service…\n");
  await deps.install();
}

/**
 * `markbase install-service`, asked for by name: always installs, but on a Mac
 * that has the desktop app says first that the service duplicates it.
 */
export async function runInstallService(
  deps: ServiceDeps = { detectDesktopApp, install: installService }
): Promise<void> {
  if (await deps.detectDesktopApp()) console.log(`Note: ${DESKTOP_APP_NOTE}\n`);
  await deps.install();
}

export async function uninstallService(): Promise<void> {
  if (process.platform === "darwin") {
    await exec("launchctl", ["unload", "-w", PLIST_PATH]).catch(() => {});
    rmSync(PLIST_PATH, { force: true });
    console.log(`Removed launchd service "${LABEL}".`);
    return;
  }
  if (process.platform === "linux") {
    await exec("systemctl", ["--user", "disable", "--now", "markbase.service"]).catch(() => {});
    rmSync(SYSTEMD_PATH, { force: true });
    await exec("systemctl", ["--user", "daemon-reload"]).catch(() => {});
    console.log('Removed systemd user service "markbase".');
    return;
  }
  console.error(`Nothing to uninstall on ${process.platform}.`);
}
