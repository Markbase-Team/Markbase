// A system notification from a process with no window — the CLI service.
//
// The Shared Vault's fork is the one thing in the daemon a person has to be
// told about after the fact (docs/shared-vault.md): the file was read-only and
// they wrote to it anyway, so the edits stay here and go nowhere. Logging it is
// not telling anyone, so the service posts the same notification the desktop
// app does, through whatever the platform has. Best effort: a machine with no
// notifier (a headless server) gets the log line and nothing else.

import { execFile } from "node:child_process";

/** AppleScript string literal: double quotes and backslashes escaped. */
function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function notify(title: string, body: string): void {
  const done = (): void => {};
  if (process.platform === "darwin") {
    execFile(
      "osascript",
      ["-e", `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`],
      done
    );
  } else if (process.platform === "linux") {
    execFile("notify-send", [title, body], done);
  }
}
