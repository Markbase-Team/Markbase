import { spawn } from "node:child_process";
import { CLI_PACKAGE, fetchLatestCliVersion, isVersionBehind } from "@markbase/protocol";
import { DESKTOP_APP_NOTE, detectDesktopApp } from "./desktop-app";
import { serviceInstalled } from "./service";

// Run a command with the user's terminal attached, and resolve with its exit code.
function run(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: false });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// How this copy of the CLI was launched. `npx pkg@version` unpacks into a
// version-keyed cache dir, so the two need different upgrade paths.
function launchedViaNpx(): boolean {
  return /[\\/]_npx[\\/]/.test(process.argv[1] ?? "");
}

/**
 * `markbase update` — upgrade the CLI and restart the background service on it.
 *
 * The catch this exists to solve: `install-service` writes `process.argv[1]` —
 * the path of the *running* cli.js — into the launchd plist / systemd unit. So a
 * service, once installed, keeps launching that exact file forever. Restarting
 * it, or even reinstalling from this old process, re-pins the old version.
 *
 * The only thing that can install the new version is the new version. So we
 * fetch it and hand off: spawn `install-service` from the freshly-resolved
 * package, and *it* bakes its own path in and reloads the service.
 */
export async function runUpdate(
  currentVersion: string,
  args: string[],
  detectApp: () => Promise<boolean> = detectDesktopApp
): Promise<void> {
  const force = args.includes("--force");

  const latest = await fetchLatestCliVersion();
  if (!latest) {
    console.error(
      "Couldn't reach the npm registry to check for updates. Try again later."
    );
    process.exitCode = 1;
    return;
  }

  if (!isVersionBehind(currentVersion, latest) && !force) {
    console.log(`Already up to date — ${CLI_PACKAGE}@${currentVersion}.`);
    return;
  }

  console.log(
    isVersionBehind(currentVersion, latest)
      ? `Updating ${CLI_PACKAGE}: ${currentVersion} → ${latest}`
      : `Reinstalling ${CLI_PACKAGE}@${latest} (--force).`
  );

  // A global install has to be upgraded in place first; the npx path resolves
  // the new version as part of the handoff below.
  if (!launchedViaNpx()) {
    console.log(`\n$ npm install -g ${CLI_PACKAGE}@${latest}`);
    const code = await run("npm", ["install", "-g", `${CLI_PACKAGE}@${latest}`]);
    if (code !== 0) {
      console.error(
        `\nnpm install failed (exit ${code}). If it's a permissions error, try ` +
          `\`sudo npm install -g ${CLI_PACKAGE}@${latest}\`.`
      );
      process.exitCode = code;
      return;
    }
  }

  if (!serviceInstalled()) {
    console.log(
      `\nUpdated. No background service is installed, so nothing to restart.\n` +
        `Run \`markbase install-service\` if you want the worker running in the background.`
    );
    return;
  }

  // A service next to the desktop app is redundant (the app runs the worker),
  // so don't reinstall it as a side effect of updating: say so, and leave the
  // decision — remove it, or restart it anyway — to an explicit command.
  if (await detectApp()) {
    console.log(
      `\nUpdated. ${DESKTOP_APP_NOTE}\n` +
        `Leaving the service as it is — \`markbase uninstall-service\` removes it, ` +
        `\`markbase install-service\` restarts it on ${latest} anyway.`
    );
    return;
  }

  // Hand off. The child is the new version, so the plist/unit it writes points
  // at the new cli.js — which is the whole point of this command.
  console.log(`\nRestarting the worker service on ${latest}…`);
  const code = launchedViaNpx()
    ? await run("npx", ["-y", `${CLI_PACKAGE}@${latest}`, "install-service"])
    : await run("markbase", ["install-service"]);

  if (code !== 0) {
    console.error(
      `\nCouldn't reinstall the service (exit ${code}). Run ` +
        `\`npx -y ${CLI_PACKAGE}@${latest} install-service\` by hand.`
    );
    process.exitCode = code;
    return;
  }
  console.log(`\nDone — worker is running ${CLI_PACKAGE}@${latest}.`);
}
