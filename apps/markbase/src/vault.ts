// `markbase vault` — mount vaults on this machine, each syncing to its own folder.
//
// The cloud says which vaults exist; this machine says where each one lives. That
// mapping is deliberately local: a folder path is per-machine, and the server has
// no business knowing it.
//
// Two sync roots over one file means two daemons claim it, each republishing the
// other's writes into a different CRDT. So an UNMARKED folder overlapping a
// mounted vault is refused here, before anything is written.
//
// Not a blanket ban on nesting, which is what this comment used to say: a folder
// carrying its own marker may live inside another vault, because that is what
// happens when someone drags one there in Finder, and the marker travelling with
// the folder is what lets us follow it. The outer daemon skips that subtree —
// see nestedVaultFor — so nothing ends up double-owned.

import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  listMarkdown,
  mountsForAccount,
  readVaultIndex,
  readVaultMarker,
  resolveKeyOwner,
  unmountVault,
  updateMountedVaults,
} from "@markbase/vault";
import { mountVault, terminalOperator } from "@markbase/flows/node";
import {
  SHARED_VAULT_DIRNAME,
  SHARED_VAULT_ID,
  SHARED_VAULT_NAME,
} from "@markbase/protocol/shared-vault";
import { loadConfig, type MountedVault } from "./config";

const HELP = `Usage:
  markbase vault list                 Your vaults, and where they're mounted here
  markbase vault mount <name> [dir]   Sync a vault to a folder on this machine
  markbase vault mount --shared [dir] Sync the documents others shared with you
                                      to a folder (default ~/Markbase/shared)
  markbase vault unmount <name>       Stop syncing it here (your files stay put)
                                      (\`shared\` for the Shared Vault)
  markbase vault status               Shared documents with local-only edits

Once mounted, \`markbase vault-sync\` keeps every mounted vault in sync.
`;

/** Where the Shared Vault goes unless told otherwise. */
const DEFAULT_SHARED_DIR = join(homedir(), "Markbase", SHARED_VAULT_DIRNAME);

interface CloudVault {
  id: string;
  name: string;
}

/** `~/Docs` -> absolute; a bare name is relative to the cwd, like every other tool. */
function expand(dir: string): string {
  const home = dir.startsWith("~") ? dir.replace(/^~/, homedir()) : dir;
  return isAbsolute(home) ? home : resolve(process.cwd(), home);
}

async function fetchVaults(appUrl: string, apiKey: string): Promise<CloudVault[]> {
  const res = await fetch(`${appUrl}/api/v1/vaults`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`couldn't list vaults (${res.status})`);
  const body = (await res.json()) as { vaults?: CloudVault[] };
  return body.vaults ?? [];
}

/** Match by name (case-insensitive) or by id, so both are pleasant to type. */
function findVault(vaults: CloudVault[], needle: string): CloudVault | undefined {
  const n = needle.toLowerCase();
  return vaults.find((v) => v.id === needle || v.name.toLowerCase() === n);
}

export async function runVault(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return;
  }

  const cfg = loadConfig();
  if (!cfg.apiKey) {
    console.error("No API key configured. Run `markbase login` first.");
    process.exitCode = 1;
    return;
  }

  // Whose key is this? The registry is machine-wide, and the desktop app may
  // have mounted folders here for a different account. Those are not this
  // account's to list, mount over or unmount: every command below sees only the
  // mounts recorded for this account (and ones recorded for nobody yet).
  const me = await resolveKeyOwner(cfg.appUrl, cfg.apiKey);
  const mine = mountsForAccount(cfg.vaults, me);

  if (sub === "list") {
    let cloud: CloudVault[];
    try {
      cloud = await fetchVaults(cfg.appUrl, cfg.apiKey);
    } catch (e) {
      console.error(`vault: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    if (cloud.length === 0) {
      console.log("No vaults yet.");
      return;
    }
    for (const v of cloud) {
      const mounted = mine.find((m) => m.vaultId === v.id);
      console.log(mounted ? `  ${v.name} → ${mounted.dir}` : `  ${v.name} (not mounted here)`);
    }
    const shared = mine.find((m) => m.vaultId === SHARED_VAULT_ID);
    console.log(
      shared
        ? `  ${SHARED_VAULT_NAME} → ${shared.dir}`
        : `  ${SHARED_VAULT_NAME} (not mounted here — \`markbase vault mount --shared\`)`
    );
    return;
  }

  if (sub === "status") {
    const shared = mine.find((m) => m.vaultId === SHARED_VAULT_ID);
    if (!shared) {
      console.log(`${SHARED_VAULT_NAME} is not mounted here. \`markbase vault mount --shared\` to sync shared documents to a folder.`);
      return;
    }
    const index = readVaultIndex(shared.dir);
    if (!index) {
      console.log(`${SHARED_VAULT_NAME} → ${shared.dir} (not synced yet)`);
      return;
    }
    const forks = index.docs.filter((d) => d.fork);
    console.log(`${SHARED_VAULT_NAME} → ${shared.dir}: ${index.docs.length} document(s)`);
    if (forks.length === 0) {
      console.log("No local-only edits.");
      return;
    }
    console.log(`${forks.length} document(s) with local-only edits (shared read-only, edited here anyway):`);
    for (const d of forks) {
      console.log(`  ${d.file} — since ${d.fork?.since ?? "?"}`);
    }
    console.log("Discard or keep them from the desktop app's Shared view, or ask the owner for edit access.");
    return;
  }

  if (sub === "mount" && args[1] === "--shared") {
    // The Shared Vault: the documents others shared with you, in one folder of
    // yours. Nothing in it is adopted, so the big-folder warning has nothing to
    // ask about; the nesting check still applies.
    const dir = expand(args[2] ?? DEFAULT_SHARED_DIR);
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const result = await mountVault(
        { vaultId: SHARED_VAULT_ID, name: SHARED_VAULT_NAME, dir, ownerId: me },
        {
          operator: terminalOperator({
            ask: (prompt) => rl.question(prompt),
            write: (line) => console.log(line),
            home: homedir(),
          }),
          // Every mount on the machine: the overlap check is about two daemons
          // claiming one folder, whichever account the other one is.
          readMounted: () => cfg.vaults.filter((m) => m.vaultId !== SHARED_VAULT_ID),
          updateMounted: updateMountedVaults,
          markerOf: readVaultMarker,
          countMarkdown: () => 0,
          startSync: () => {},
        }
      );
      if (!result.ok) {
        if (result.reason !== "refused") console.log("Nothing was mounted.");
        process.exitCode = 1;
        return;
      }
      console.log(`Mounted the ${SHARED_VAULT_NAME} → ${result.dir}`);
      console.log("Documents shared with you land there as <owner>/<title>.md; ones you may only read are read-only.");
      console.log("Run `markbase vault-sync` to start syncing.");
    } finally {
      rl.close();
    }
    return;
  }

  if (sub === "mount") {
    const needle = args[1];
    if (!needle) {
      console.error("Which vault? `markbase vault mount <name> [dir]`, or `--shared`");
      process.exitCode = 1;
      return;
    }
    let cloud: CloudVault[];
    try {
      cloud = await fetchVaults(cfg.appUrl, cfg.apiKey);
    } catch (e) {
      console.error(`vault: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
      return;
    }
    const vault = findVault(cloud, needle);
    if (!vault) {
      console.error(`No vault called "${needle}". Try \`markbase vault list\`.`);
      process.exitCode = 1;
      return;
    }
    const dir = expand(args[2] ?? vault.name);
    // A folder that is not there yet is made, as the desktop app makes
    // ~/Markbase/<name>. The usual case for a vault created on the web (or in
    // the app, on another Mac) is that this machine has no folder for it, and
    // the default — a folder named after the vault — never exists in advance.
    // The flow counts the folder's markdown before mounting, and counting a
    // missing folder used to be a raw ENOENT stack trace here.
    if (!existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
        console.log(`Created ${dir}`);
      } catch (e) {
        console.error(`vault: couldn't create ${dir}: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
        return;
      }
    }

    // Mounting is the shared flow — the same one the desktop app runs. Only the
    // asking differs, and here whoever is at this terminal answers.
    //
    // One thing changes by moving: the big-folder warning. This command adopted
    // every markdown file in a folder without comment, while the desktop has
    // asked first since a vault pointed at a source repository turned into 398
    // documents in twenty minutes. Both ask now.
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const result = await mountVault(
        // Recorded as this account's from the start: the cloud list just
        // vouched for the vault, and the key's owner is who mounts it.
        { vaultId: vault.id, name: vault.name, dir, ownerId: me },
        {
          operator: terminalOperator({
            ask: (prompt) => rl.question(prompt),
            write: (line) => console.log(line),
            home: homedir(),
          }),
          // Everything except this vault: re-mounting it moves it, and its old
          // entry must not sit there as a second home for the same id.
          readMounted: () => cfg.vaults.filter((m) => m.vaultId !== vault.id),
          updateMounted: updateMountedVaults,
          markerOf: readVaultMarker,
          countMarkdown: (d) => listMarkdown(d).length,
          // Registration only. `markbase vault-sync` is what starts syncing,
          // and the line below says so.
          startSync: () => {},
        }
      );
      if (!result.ok) {
        // The flow has already said which folder it refused and why.
        if (result.reason !== "refused") console.log("Nothing was mounted.");
        process.exitCode = 1;
        return;
      }
      console.log(`Mounted "${vault.name}" → ${result.dir}`);
      console.log("Run `markbase vault-sync` to start syncing.");
    } finally {
      rl.close();
    }
    return;
  }

  if (sub === "unmount") {
    const needle = args[1];
    const mounted: MountedVault | undefined = mine.find(
      (m) =>
        m.vaultId === needle ||
        m.name.toLowerCase() === (needle ?? "").toLowerCase() ||
        (m.vaultId === SHARED_VAULT_ID && needle === "--shared")
    );
    if (!mounted) {
      console.error(`"${needle}" isn't mounted here.`);
      process.exitCode = 1;
      return;
    }
    // An edit to the registry, and nothing else. This used to write back the
    // whole vault list minus one entry, built from a read taken when the command
    // started — so a vault mounted meanwhile, in the desktop app or another
    // terminal, was unmounted too, silently, by a command that named a different
    // vault.
    // Tombstoned, not just removed: the folder stays on disk, and reclaimVaults
    // reconnects vault folders the registry has forgotten. Without a record of
    // the decision it cannot tell those apart, and a running `markbase start`
    // would mount this again on its next pass.
    await unmountVault(mounted.vaultId);
    console.log(`Unmounted "${mounted.name}". Your files in ${mounted.dir} are untouched.`);
    // True as of the supervisor: a running `markbase start` or the desktop app
    // sees the registry change on its next pass and stops that vault's daemon.
    // Before that, this command was advisory and the daemon synced on regardless.
    console.log("Any running sync for it stops within a few seconds.");
    return;
  }

  console.error(`Unknown vault command: ${sub}\n`);
  console.log(HELP);
  process.exitCode = 1;
}
