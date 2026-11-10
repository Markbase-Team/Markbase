"use client";

import { useCallback, useEffect, useState } from "react";
import { useDocsPorts, type VaultsPort } from "./ports";

/**
 * Which vaults exist as folders on THIS machine, keyed by vault id.
 *
 * The vault list is an account-level thing — every vault you own, from every
 * machine. Whether one of them is a folder you can open in Finder is a fact only
 * the desktop shell holds, so the list showed them all identically: a vault
 * synced to ~/Repo/Blog looked exactly like one that has never touched this Mac,
 * and there was no way to mount the latter without going through New Vault.
 *
 * `supported` is false in a browser and on desktop builds too old to answer. That
 * is deliberately distinct from "nothing is mounted" — a UI that can't tell
 * should say nothing rather than label every vault cloud-only.
 */
export interface MountedVaults {
  /** vaultId -> the folder it syncs to on this machine. */
  dirs: Record<string, string>;
  /** Can this client answer the question at all? */
  supported: boolean;
  /** Re-read after mounting, so the row updates without a reload. */
  refresh: () => Promise<void>;
}

/**
 * The vaults this machine has on disk, or null when it cannot say — either there
 * is no vaults port (a browser), or there is one and it would not answer. Both
 * are the same answer to the caller: showing every vault as cloud-only would be
 * a lie.
 */
async function readMounted(vaults: VaultsPort | null): Promise<Record<string, string> | null> {
  if (!vaults) return null;
  try {
    const mounted = await vaults.mounted();
    return Object.fromEntries(mounted.map((m) => [m.vaultId, m.dir]));
  } catch {
    return null;
  }
}

export function useMountedVaults(): MountedVaults {
  const { vaults } = useDocsPorts();
  const [dirs, setDirs] = useState<Record<string, string>>({});
  const [supported, setSupported] = useState(false);

  const apply = useCallback((next: Record<string, string> | null) => {
    setSupported(next !== null);
    if (next) setDirs(next);
  }, []);

  const refresh = useCallback(async () => apply(await readMounted(vaults)), [apply, vaults]);

  // The read lives inside the async body — a setState reached synchronously from
  // an effect costs a render pass before anything paints — and the answer is
  // dropped if this unmounts first, which the old shape had no way to do.
  //
  // And re-read whenever the shell says the mount set changed. A vault mounted
  // through a native dialog — the first-run offer, the Vaults menu, the tray —
  // never passed through this component's own mount action, so the one read
  // above was all it ever had, and the switcher kept showing that vault as
  // cloud-only until something happened to re-render it.
  useEffect(() => {
    let cancelled = false;
    const read = (): void => {
      void (async () => {
        const next = await readMounted(vaults);
        if (!cancelled) apply(next);
      })();
    };
    read();
    const off = vaults?.onMountsChanged?.(read);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [apply, vaults]);

  return { dirs, supported, refresh };
}
