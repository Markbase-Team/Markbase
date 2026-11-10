import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { markbaseHome } from "@markbase/vault";
import { dirname, join } from "node:path";
import {
  readMountedVaults,
  saveInstance as writeInstance,
  type MountedVault,
  type SavedInstance,
} from "@markbase/vault";
import { DEFAULT_APP_URL } from "@markbase/protocol/instance";

// Where the per-user config lives. Holds the API key, so it's written 0600.
export const CONFIG_DIR = markbaseHome();
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export { DEFAULT_APP_URL };

export interface MarkbaseConfig {
  /** Web app base URL. */
  appUrl: string;
  /** The owner's API key (jsk_…). */
  apiKey: string;
  /** Folder to mirror documents into as .md files; empty = mirroring is off. */
  mirrorDir: string;
  /** Vaults mounted on this machine — each syncs to its own folder. */
  vaults: MountedVault[];
}

// The mounted-vault list is shared with the desktop app — one registry per
// machine, in this same file. See packages/core/src/vault-registry.ts.
export type { MountedVault };

/** The default place the mirror lives, when the user doesn't name one. */
export const DEFAULT_MIRROR_DIR = join(homedir(), "Markbase");

// Which instance this machine talks to. The hosted app unless `markbase
// instance <url>` (or `markbase login --app-url <url>`) pointed it at a
// self-hosted one, which is saved in the config file beside the key. An env
// var (MARKBASE_APP_URL / APP_URL) overrides both, for pointing at a dev server.
export function appUrl(): string {
  const url =
    process.env.MARKBASE_APP_URL ??
    process.env.APP_URL ??
    readFile().appUrl ??
    DEFAULT_APP_URL;
  return url.replace(/\/+$/, "");
}

/** True when this machine talks to the hosted app, not an instance of its own. */
export function usesDefaultInstance(): boolean {
  return appUrl() === DEFAULT_APP_URL;
}

// Read config. Only the API key is persisted; the app URL is derived above.
// MARKBASE_API_KEY (the same name the skill, `markbase api`, and the MCP config use)
// overrides the saved key — so the MCP server picks up the key Claude Desktop
// sets in its config env.
interface ConfigFile {
  apiKey?: string;
  mirrorDir?: string;
  vaults?: MountedVault[];
  /**
   * A self-hosted instance (SELF-HOSTING.md): its URL, and the Supabase project
   * it told us it runs on (GET /api/v1/instance). Absent for the hosted app.
   * The CLI itself reads only the URL — everything it does goes through the
   * API — but the desktop app reads all three from this same file: its windows
   * still join a document's live channel on the project directly. Pointing the
   * CLI at an instance therefore points the app too.
   */
  appUrl?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}

function readFile(): ConfigFile {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as ConfigFile;
  } catch {
    return {}; // no config file yet — fall back to env
  }
}

export function loadConfig(): MarkbaseConfig {
  const file = readFile();
  const apiKey = process.env.MARKBASE_API_KEY ?? file.apiKey ?? "";
  return {
    appUrl: appUrl(),
    apiKey,
    mirrorDir: process.env.MARKBASE_MIRROR_DIR ?? file.mirrorDir ?? "",
    vaults: readMountedVaults(),
  };
}

// Merge into the existing file — a partial write must never drop the API key
// (or the mirror dir) that another command put there.
function patchConfig(patch: ConfigFile): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const next = { ...readFile(), ...patch };
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
}

export function saveConfig(apiKey: string): void {
  patchConfig({ apiKey });
}

/** Point the mirror at `dir`, or pass "" to turn mirroring off. */
export function saveMirrorDir(dir: string): void {
  patchConfig({ mirrorDir: dir });
}

export type { SavedInstance };

/**
 * Point this machine (CLI and desktop app alike) at an instance. The write is
 * the registry's own — under its lock and atomic — since the desktop app
 * writes the same three keys from its "Connect to a team instance" control.
 */
export function saveInstance(instance: SavedInstance): Promise<void> {
  return writeInstance(instance);
}

/** The instance saved by `markbase instance`, or null for the hosted app. */
export function savedInstance(): SavedInstance | null {
  const { appUrl, supabaseUrl, supabaseKey } = readFile();
  if (!appUrl || !supabaseUrl || !supabaseKey) return null;
  return { appUrl, supabaseUrl, supabaseKey };
}

// saveVaults used to live here: it took a whole list and replaced the registry
// with it. Every caller built that list from a read taken earlier — at the top
// of `vault mount`, or when the daemon started — so a vault mounted by the other
// client in between was overwritten out of existence. Mount, unmount and
// reconcile now go through updateMountedVaults, which applies a change under the
// registry's lock instead of trusting a snapshot.
