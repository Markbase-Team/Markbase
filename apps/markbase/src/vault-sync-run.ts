// `markbase vault-sync` — keep every mounted vault in sync, driven by the shared
// engine in @markbase/protocol (which the desktop app's main process also drives).
// This file is only the CLI's config + lifecycle: read config.json, start a
// daemon per vault, stop them all on Ctrl-C.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  confirmMountAccount,
  mountsForAccount,
  readUnmountedVaults,
  readVaultMarker,
  readVaultMarkerInfo,
  resolveKeyOwner,
  startVaultSync,
  updateMountedVaults,
  type MountedVault,
} from "@markbase/vault";
// unattendedOperator is pure policy — no machine behind it — so it lives in the
// isomorphic entry. The flows and the terminal operator need one, and don't.
import { unattendedOperator } from "@markbase/flows";
import {
  reclaimVaults,
  repointVault,
  startVaultSupervisor,
  terminalOperator,
  type ReconcileDeps,
} from "@markbase/flows/node";
import { SHARED_VAULT_ID } from "@markbase/protocol/shared-vault";
import { DEFAULT_MIRROR_DIR, loadConfig } from "./config";
import { notify } from "./notify";

/**
 * Start a sync daemon for every configured vault and return their stop handles.
 * The caller owns the lifecycle (the standalone `vault-sync` command waits on a
 * signal; `markbase start` just lets them run for the process's life). Returns
 * `[]` when there's no key or nothing could start.
 */
/**
 * What the shared reconcile flows need here.
 *
 * The operator is chosen by whether anyone is watching. Under launchd there is
 * no terminal: a repoint question would block the daemon's startup on an answer
 * that is never coming, so the unattended operator declines it and says so in
 * the log. Run by hand, the same flow asks.
 */
/**
 * The account the configured key belongs to, once /api/v1/me has answered.
 *
 * The registry is machine-wide and the desktop app may have mounted folders for
 * a different account on this machine; only the entries recorded for THIS
 * account are declared to the supervisor (2026-10-30: the alternative uploaded
 * one account's files as another's documents). Null until the API answers —
 * and null hides nothing, so the per-vault confirmation in startOne is what
 * decides until then.
 */
let keyOwner: string | null = null;

/** The mounts this account may sync — and the only folders a repo scan may look in. */
export function myMounts(): MountedVault[] {
  return mountsForAccount(loadConfig().vaults, keyOwner);
}

function reconcileDeps(cfg: ReturnType<typeof loadConfig>): ReconcileDeps {
  const attended = Boolean(stdout.isTTY);
  const rl = attended ? createInterface({ input: stdin, output: stdout }) : null;
  return {
    operator: rl
      ? terminalOperator({
          ask: (prompt) => rl.question(prompt),
          write: (line) => console.log(line),
          home: homedir(),
        })
      : unattendedOperator({ log: (line) => console.log(`[vault-sync] ${line}`) }),
    readMounted: myMounts,
    readUnmounted: readUnmountedVaults,
    updateMounted: updateMountedVaults,
    markerOf: readVaultMarker,
    markerOwnerOf: (dir) => readVaultMarkerInfo(dir)?.ownerId ?? null,
    keyOwner: () => keyOwner,
    listCloudVaults: async () => {
      try {
        const res = await fetch(`${cfg.appUrl}/api/v1/vaults`, {
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { vaults?: { id: string; name: string }[] };
        // A missing field is "I don't know", not "you have none" — see
        // ReconcileDeps.listCloudVaults.
        return body.vaults ?? null;
      } catch {
        return null;
      }
    },
    // Registration only; the daemons below start from the config that results.
    startSync: () => {},
    listSubdirs: (dir) =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => join(dir, e.name))
        : [],
    defaultHome: join(homedir(), "Markbase"),
    close: () => rl?.close(),
  };
}

/** What the caller holds: everything syncing here, and how to stop it. */
export interface VaultSyncHandle {
  stop: () => Promise<void>;
  count: () => number;
}

export async function startVaultSyncDaemons(): Promise<VaultSyncHandle | null> {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    console.error("No API key configured. Run `markbase login` first.");
    return null;
  }

  // Whose key is this? Asked once up front so the first pass already knows
  // which mounts are this account's; asked again per vault while unknown.
  keyOwner = await resolveKeyOwner(cfg.appUrl, cfg.apiKey);
  if (keyOwner) {
    const all = loadConfig().vaults.length;
    const mine = myMounts().length;
    if (all > mine) console.log(`[vault-sync] ${all - mine} vault(s) on this machine were mounted by another account — left alone`);
  }

  // A vault folder the registry forgot — a reinstall, a copied config — is
  // reconnected before anything starts, so its daemon comes up with the others
  // rather than after someone notices it missing. The desktop app has done this
  // since it shipped; the CLI could not, which is why a server had no way back
  // from a lost registry.
  const rd = reconcileDeps(cfg);
  try {
    const reclaimed = await reclaimVaults(rd);
    if (reclaimed > 0) console.log(`[vault-sync] reconnected ${reclaimed} vault(s) found on disk`);
  } catch (e) {
    console.error(`[vault-sync] reclaim failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    rd.close?.();
  }

  /** Start one folder syncing. The supervisor calls this; so does the fallback. */
  const startOne = async (t: { vaultId?: string; name: string; dir: string }) => {
    const log = (m: string): void => console.log(`[${t.name}] ${m}`);
    // Whose vault is this, and is it this key's? Settled BEFORE a daemon exists
    // for it: a mount recorded for nobody yet is confirmed with the API and the
    // answer written down; one that is not this account's is never started.
    // The legacy single-folder mode has no vault to bind.
    let owner: string | null = null;
    if (t.vaultId) {
      if (keyOwner === null) keyOwner = await resolveKeyOwner(cfg.appUrl, cfg.apiKey);
      owner = await confirmMountAccount(
        { vaultId: t.vaultId, name: t.name, dir: t.dir },
        { appUrl: cfg.appUrl, apiKey: cfg.apiKey, keyOwner }
      );
      if (owner === null) {
        throw new Error("couldn't confirm which account this vault belongs to yet — not syncing until it can");
      }
    }
    return startVaultSync({
      lockOwner: "cli",
      dir: t.dir,
      vaultId: t.vaultId,
      appUrl: cfg.appUrl,
      apiKey: cfg.apiKey,
      ...(owner ? { ownerId: owner } : {}),
      log,
      // A vault found sitting inside this one — dragged there in Finder,
      // usually. We are the only place that knows where it went, so offer
      // to follow it. Under launchd the unattended operator declines and
      // logs; run by hand, it asks.
      onForeignVault: (found) => {
        void repointVault({ vaultId: found.vaultId, dir: found.dir }, t.name, reconcileDeps(cfg))
          .catch((e) => log(`repoint failed: ${e instanceof Error ? e.message : String(e)}`));
      },
      // The Shared Vault (docs/shared-vault.md): a document shared read-only
      // whose file was edited anyway is kept as a local fork. The service has
      // no window, so it says so the way the desktop app does — a system
      // notification, once per fork — and `markbase vault status` lists them.
      sharedHost:
        t.vaultId === SHARED_VAULT_ID
          ? {
              onForks: (forks, fresh) => {
                for (const f of fresh) {
                  notify(
                    "Local-only edits",
                    `"${f.title}" is shared with you read-only. Your edits to ${f.path} stay on this machine.`
                  );
                }
                if (forks.length > 0) {
                  log(`${forks.length} document(s) with local-only edits — \`markbase vault status\` lists them`);
                }
              },
            }
          : undefined,
    });
  };

  // With no vaults mounted we fall back to the legacy single-folder behaviour:
  // every document you can see, one folder, no vault id — so no marker and no
  // nesting to police. It has no id to key on, so the supervisor cannot manage
  // it; it is started once here and stopped with everything else.
  let stopLegacy: (() => Promise<void>) | null = null;
  if (!myMounts().length) {
    console.log("[vault-sync] no vaults mounted — syncing everything into one folder.");
    console.log("[vault-sync] `markbase vault list` to see your vaults, `vault mount` to split them up.");
    try {
      stopLegacy = await startOne({
        vaultId: undefined,
        name: "documents",
        dir: cfg.mirrorDir || DEFAULT_MIRROR_DIR,
      });
    } catch (e) {
      console.error(`[documents] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // The same loop the desktop app runs. It is what makes `markbase vault mount`
  // and `vault unmount` take effect in a running service: this process used to
  // read the vault list once at startup and never look again, so an unmounted
  // vault kept syncing until someone restarted the daemon.
  const supervisor = startVaultSupervisor({
    // Only this account's mounts are ever declared, so a folder another
    // account mounted on this machine is never started, whatever key this is.
    readMounted: myMounts,
    startSync: startOne,
    log: (m) => console.log(`[vault-sync] ${m}`),
    retryMs: 5000,
  });
  await supervisor.settled();

  return {
    stop: async () => {
      await supervisor.stop();
      if (stopLegacy) await stopLegacy();
    },
    count: () => supervisor.running().length + (stopLegacy ? 1 : 0),
  };
}

export async function runVaultSync(): Promise<void> {
  const handle = await startVaultSyncDaemons();
  const declared = myMounts().length;
  // Nothing mounted and nothing syncing is a real failure. Vaults mounted but
  // none running is NOT: the desktop app holds their locks, and staying up to
  // take over when it quits is the whole reason this loop exists.
  if (!handle || (handle.count() === 0 && declared === 0)) {
    console.error("vault-sync: nothing is syncing.");
    process.exitCode = 1;
    return;
  }
  console.log(`[vault-sync] ${handle.count()} of ${declared || 1} vault(s) syncing — Ctrl-C to stop`);

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void handle.stop().then(() => resolve());
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
