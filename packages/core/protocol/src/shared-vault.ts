// The Shared Vault: what every client agrees on about it (docs/shared-vault.md).
//
// A document shared with me lives in its owner's vault, and the daemon can no
// more put it in one of MY vaults than it could put it in the owner's folder on
// my disk. So every document shared with a user lands in one pseudo vault,
// mounted through the same registry and run by the same sync loop as a real
// one. The id is a word the web UI already used for the "Shared with me" scope
// (`SHARED_SCOPE` in @markbase/docs/ui), which the API lists as
// `GET /docs?scope=shared`; a UUID never collides with it.
//
// Where a shared document lands inside that folder is decided here, once, so
// the API (which reports it), the daemon (which writes it) and the web tree
// (which groups by it) agree.

/** The pseudo vault id. Never a row in docs.vaults. */
export const SHARED_VAULT_ID = "shared";

/** What a person sees it called — in the registry, the menu, the CLI. */
export const SHARED_VAULT_NAME = "Shared Vault";

/** Where it is proposed to live: beside the user's own vaults, as `shared`. */
export const SHARED_VAULT_DIRNAME = "shared";

export function isSharedVault(vaultId: string | null | undefined): boolean {
  return vaultId === SHARED_VAULT_ID;
}

/** Filesystem-safe single path segment (the separators are already split off). */
export function sanitizePathSegment(s: string): string {
  return s.replace(/[/\\:*?"<>|]+/g, "-").trim() || "untitled";
}

/**
 * The default place for a shared document inside the member's Shared Vault:
 * `<owner display name>/<title>.md`. Used until the member moves it (which sets
 * `docs.members.path`), so the owner's own folder structure never leaks into a
 * folder that is not theirs, and two owners' "Notes.md" never fight over a name.
 */
export function sharedDocPath(ownerName: string, title: string): string {
  return `${sanitizePathSegment(ownerName)}/${sanitizePathSegment(title)}.md`;
}
