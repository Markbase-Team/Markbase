import {
  convertFolderToVault,
  createVault,
  deleteVault,
  getVault,
  listVaultsForUser,
  renameVault,
  seedWelcomeDoc,
  type VaultRow,
} from "../server";
import { accountActor } from "./actor";
import { json } from "./respond";

/**
 * The vault, if it is this caller's — else the refusal to send.
 *
 * Two refusals, kept apart on purpose: 404 means there is no such vault, 403
 * means there is one and it is somebody else's. They used to be one 404 ("the
 * caller learns nothing about vaults that aren't theirs"), and the two things
 * a daemon has to do about them are opposites: a vault that is GONE has its
 * folder retired, a vault that is NOT YOURS is left exactly as it is. A client
 * that cannot tell them apart either trashes another account's files or can
 * never retire a deleted vault. What a 403 gives away is that a UUID exists —
 * a 122-bit id nobody can enumerate — which is a fair price for a daemon that
 * knows which of the two it is looking at (incident of 2026-10-30).
 */
async function ownVault(id: string, userId: string): Promise<{ vault: VaultRow } | { error: Response }> {
  const vault = await getVault(id);
  if (!vault) return { error: json({ error: "Vault not found" }, 404) };
  if (vault.owner_id !== userId) return { error: json({ error: "You don't own this vault." }, 403) };
  return { vault };
}

// A vault is a named collection of documents that syncs to one local folder, so
// Work and Personal can be kept apart. The vault→folder mapping is NOT here: a
// local path is per-machine, so the CLI/desktop hold it.

export const vaultsHandler = {
  // GET — the caller's vaults, oldest first (the first is default).
  GET: async (req: Request): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;
    // No auto-seed: a user with no vault gets an empty list, which the UI
    // turns into the "create your first vault" onboarding. (A document created
    // without a vault_id still resolves a default in POST /docs, so the
    // invariant that every document lives in a vault holds.)
    return json({ vaults: await listVaultsForUser(a.userId) });
  },

  // POST — create a vault. { name }
  POST: async (req: Request): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;

    let body: { name?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const name = body.name?.trim();
    if (!name) return json({ error: "name is required" }, 400);

    // An account's first vault arrives with a Welcome document in it — the
    // first thing a new person sees in the folder they just mounted. Only the
    // first: a second vault's owner has seen it. Best-effort: a vault without
    // its welcome is a vault; a failed welcome must not fail the vault.
    const first = (await listVaultsForUser(a.userId)).length === 0;
    const vault = await createVault({ name, owner_id: a.userId });
    if (first) {
      try {
        await seedWelcomeDoc(a.userId, vault.id);
      } catch {
        // the vault exists; the welcome is a nicety
      }
    }
    return json({ vault }, 201);
  },
};

export const vaultHandler = {
  /**
   * GET — does this vault still exist, and is it yours?
   *
   * Exists so a client can ASK about one vault rather than infer from a list.
   * The desktop app unmounts a vault it believes was deleted in the cloud, and
   * moves that folder's files to .trash — so "absent from the list" is far too
   * weak a basis: a 200 carrying a short or malformed list looks exactly like
   * a deletion of everything it omits. It has already cost a vault, which sat
   * unmounted for five days with nobody able to say why.
   *
   * A 404 here is an answer about THAT vault: it is gone. A 403 is a different
   * answer: it exists and is not the caller's (see ownVault) — a daemon holding
   * its folder must not sync it, and must not retire it either. Anything else
   * — 200, a timeout, a 500 — is not an answer, and the caller is expected to
   * do nothing.
   */
  GET: async (req: Request, id: string): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;
    const own = await ownVault(id, a.userId);
    if ("error" in own) return own.error;
    return json({ vault: own.vault });
  },

  // PATCH — rename a vault. { name }
  PATCH: async (req: Request, id: string): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;

    let body: { name?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const name = body.name?.trim();
    if (!name) return json({ error: "name is required" }, 400);

    const own = await ownVault(id, a.userId);
    if ("error" in own) return own.error;

    await renameVault(id, name);
    return json({ vault: { ...own.vault, name } });
  },

  // DELETE — delete a vault and all its documents (cloud side). The
  // desktop/CLI daemon moves the local files to the folder's .trash/ when it
  // sees the vault vanish from the list.
  DELETE: async (req: Request, id: string): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;
    // Settled here, with the same two answers as GET and PATCH; deleteVault's
    // own check (one "not found" for both) stays as the belt to these braces.
    const own = await ownVault(id, a.userId);
    if ("error" in own) return own.error;

    try {
      await deleteVault(id, a.userId);
      return json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return json({ error: message }, /not found/i.test(message) ? 404 : 500);
    }
  },
};

// POST — promote a folder inside a vault to a vault of its own.
// { fromVaultId, folder, name }
//
// The operation a mount can't do. Mounting points a folder at a vault that
// already EXISTS, so mounting a plain folder inside a vault is refused — this
// is what that refusal points at. The documents under the folder move into the
// new vault and their paths are re-based, because a path is vault-relative and
// the folder is now the root.
export const vaultConvertHandler = async (req: Request): Promise<Response> => {
  const a = await accountActor(req);
  if ("error" in a) return a.error;

  let body: { fromVaultId?: string; folder?: string; name?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const fromVaultId = body.fromVaultId?.trim();
  const folder = body.folder?.trim();
  const name = body.name?.trim();
  if (!fromVaultId) return json({ error: "fromVaultId is required" }, 400);
  if (!folder) return json({ error: "folder is required" }, 400);
  if (!name) return json({ error: "name is required" }, 400);

  try {
    const { vault, moved } = await convertFolderToVault({
      ownerId: a.userId,
      fromVaultId,
      folder,
      name,
    });
    return json({ vault, moved }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // "Vault not found" covers both a bad id and someone else's vault: the
    // caller learns nothing about vaults that aren't theirs.
    return json({ error: message }, /not found|root/i.test(message) ? 400 : 500);
  }
};
