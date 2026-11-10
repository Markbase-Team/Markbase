// Where the Claude binary this app runs actually lives.
//
// The Agent SDK ships its own `claude` executable in a per-platform package, and
// we deliberately use THAT one rather than whatever is on the user's PATH. It is
// what makes the app self-contained: someone who downloads the DMG has never
// installed Claude Code, and never needs to.
//
// Two layouts, because npm hoists differently than electron-builder packs:
//
//   dev        node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude
//   packaged   Resources/app.asar.unpacked/node_modules/@anthropic-ai/
//                claude-agent-sdk/node_modules/@anthropic-ai/…-darwin-arm64/claude
//
// The packaged path MUST be the unpacked one. An executable inside app.asar
// cannot be spawned — the archive is not a filesystem — so a path resolved
// through the asar copy fails with ENOENT no matter that the bytes are there.

import { app } from "electron";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

/** e.g. "claude-agent-sdk-darwin-arm64" — the SDK's per-platform package. */
function platformPackage(): string {
  const ext = process.platform === "win32" ? ".exe" : "";
  return `claude-agent-sdk-${process.platform}-${process.arch}${ext ? "" : ""}`;
}

function binaryName(): string {
  return process.platform === "win32" ? "claude.exe" : "claude";
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Every place the binary might be, most-specific first. */
function candidates(): string[] {
  const pkg = platformPackage();
  const bin = binaryName();
  const out: string[] = [];

  if (app.isPackaged) {
    // electron-builder unpacks executables here; the asar copy is unspawnable.
    const unpacked = join(process.resourcesPath, "app.asar.unpacked", "node_modules");
    out.push(join(unpacked, "@anthropic-ai", "claude-agent-sdk", "node_modules", "@anthropic-ai", pkg, bin));
    out.push(join(unpacked, "@anthropic-ai", pkg, bin));
  }

  // Dev: walk up from dist/ looking for a node_modules that has it, so this works
  // from the app folder or the monorepo root without hard-coding either depth.
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const nm = join(dir, "node_modules", "@anthropic-ai");
    out.push(join(nm, pkg, bin));
    out.push(join(nm, "claude-agent-sdk", "node_modules", "@anthropic-ai", pkg, bin));
    dir = join(dir, "..");
  }
  return out;
}

let cached: string | null | undefined;

/**
 * The bundled `claude`, or null if this build somehow shipped without one (a
 * platform package that didn't install, or a build for another architecture).
 *
 * Never falls back to PATH. A silent fallback would make the app work on the
 * developer's machine — where `claude` is installed — and fail only for the
 * downloaded users we are shipping to, which is the worst place to find out.
 */
export function bundledClaudePath(): string | null {
  if (cached !== undefined) return cached;
  cached = candidates().find(executable) ?? null;
  return cached;
}

/** For error messages: where we looked, so a missing binary is diagnosable. */
export function bundledClaudeSearchPaths(): string[] {
  return candidates();
}
