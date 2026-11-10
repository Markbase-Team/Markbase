import { vi } from "vitest";
import type { MountedVault } from "@markbase/vault/vault-registry";

/**
 * A stand-in for the shared registry, for flows that change it.
 *
 * The real one (packages/core/src/vault-registry.ts) takes a mutator and applies
 * it under a lock, against the list as it is at the moment of writing — not as
 * the caller last saw it. This models that, so a test can say what another
 * process did in between.
 *
 * Tests assert on `list` — what ended up on disk — rather than on the argument a
 * writer was called with. That distinction is the whole point of the seam: a
 * flow that hands over a whole list it computed from a stale read looks exactly
 * like one that merges, right up until something else writes between the read
 * and the write, and then one of them silently erases the other's work.
 */
export function fakeRegistry(initial: MountedVault[] = []) {
  let vaults = [...initial];
  return {
    // A copy, like a real read: holding a reference to the live list would hide
    // staleness, which is the thing being tested.
    read: (): MountedVault[] => [...vaults],
    update: vi.fn(async (next: (current: MountedVault[]) => MountedVault[]) => {
      vaults = next(vaults);
      return vaults;
    }),
    /** What another process wrote while this one was still deciding. */
    concurrentlyAdd(v: MountedVault): void {
      vaults = [...vaults, v];
    },
    get list(): MountedVault[] {
      return vaults;
    },
  };
}
