import { createVault, deleteVault, listVaultsForUser, type VaultRow } from "./vaults";
import { seedWelcomeDoc } from "./welcome";

// An account's first vault, and the Welcome document that arrives in it.
//
// There are two ways an account comes to have one, and both end here so they
// end in the same state:
//
//   - the person names a vault in the app (POST /vaults), or
//   - the person connects an agent before ever opening the app
//     (/oauth/authorize/approve), and the vault is made for them.
//
// The second exists because of a signup on 2026-11-22: a person added Markbase
// as a connector inside their AI app, signed up on the way through, and never
// saw the app. The first vault was only ever created by the app's first-vault
// dialog, so their agent connected to an account with no vault and no
// document, found nothing to list, and the person did not come back.

/** What a vault made on the person's behalf is called. They can rename it. */
export const DEFAULT_VAULT_NAME = "My Vault";

// Best-effort: a vault without its welcome is a vault; a failed welcome must
// not fail the vault.
async function welcomeInto(userId: string, vaultId: string): Promise<void> {
  try {
    await seedWelcomeDoc(userId, vaultId);
  } catch {
    // the vault exists; the welcome is a nicety
  }
}

/**
 * Create a vault the person named. An account's first one arrives with the
 * Welcome document in it; a later one does not, since its owner has seen it.
 */
export async function createVaultForAccount(userId: string, name: string): Promise<{ vault: VaultRow; first: boolean }> {
  const first = (await listVaultsForUser(userId)).length === 0;
  const vault = await createVault({ name, owner_id: userId });
  if (first) await welcomeInto(userId, vault.id);
  return { vault, first };
}

/** Oldest first, as listVaultsForUser orders them, with the id settling a tie. */
function oldest(vaults: VaultRow[]): VaultRow {
  return [...vaults].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0];
}

/**
 * Make sure the account has a vault, creating its first (with the Welcome
 * document) if it has none. Safe to call again: an account with a vault is
 * left exactly as it is, so a second approval, a retry or a reconnect adds
 * nothing.
 *
 * Two calls at the same moment (a double-pressed button) can both find no
 * vault and both create one. Each looks again after creating; the one that
 * finds an older vault than its own removes its own, before anything is put
 * in it, so the account still ends with one vault and one Welcome document.
 */
export async function ensureFirstVault(userId: string): Promise<{ vault: VaultRow; created: boolean }> {
  const existing = await listVaultsForUser(userId);
  if (existing.length > 0) return { vault: existing[0], created: false };

  const mine = await createVault({ name: DEFAULT_VAULT_NAME, owner_id: userId });
  const keeper = oldest([mine, ...(await listVaultsForUser(userId))]);
  if (keeper.id !== mine.id) {
    await deleteVault(mine.id, userId);
    return { vault: keeper, created: false };
  }
  await welcomeInto(userId, mine.id);
  return { vault: mine, created: true };
}
