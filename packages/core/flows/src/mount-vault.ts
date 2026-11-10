// The modules, not the node barrel. "@markbase/vault" re-exports vault-fs,
// which reaches @markbase/docs, which drags that package's whole source into
// this one's typecheck for the sake of two symbols. vault-boundary and
// vault-registry reach nothing but node builtins.
import { resolve, sep } from "node:path";
import { checkMount, type MountVerdict } from "@markbase/vault/vault-boundary";
import type { MountedVault } from "@markbase/vault/vault-registry";
import type { Operator } from "./operator";

// Give a cloud vault a folder on this machine.
//
// The steps are the same in every client: resolve a folder, refuse one that
// belongs to (or sits inside) another vault, warn before adopting a large one,
// register it, start syncing. The desktop app and the CLI each had their own
// copy, differing only in how they asked. The asking is the Operator now, and
// everything the flow touches arrives through MountVaultDeps — so a test can
// run it with no filesystem at all.

/**
 * Above this many markdown files, ask before adopting the folder.
 *
 * Mounting uploads every markdown file as a document, one round trip each, with
 * no undo. A vault pointed at a source repository created 398 documents in
 * twenty minutes before anyone could see what was happening. A folder of notes
 * sits well under this and is never asked about.
 */
export const ADOPT_WARN_AT = 50;

export interface MountVaultInput {
  vaultId: string;
  name: string;
  /**
   * The account mounting it — the user id the client's key resolved to. Written
   * on the registry entry so that only this account's processes sync the
   * folder (MountedVault.ownerId). Omit when the client could not resolve it;
   * the daemon records it on the first sync the API confirms.
   */
  ownerId?: string | null;
  /** Already chosen by the caller. Omit to ask the operator for one. */
  dir?: string;
  /**
   * Where to put it when nobody chose: used as `dir` without asking. The
   * desktop's New Vault dialog passes `~/Markbase/<vault name>`, which it
   * showed as the default — so Create means create, not "now pick a folder".
   * Only consulted when `dir` is absent; the Vaults menu's "Mount a Vault…"
   * passes neither and still asks, because an existing vault often already has
   * a folder somewhere.
   */
  defaultDir?: string;
  /** Suggest the default home in the folder prompt. */
  isFirstVault?: boolean;
}

export interface MountVaultDeps {
  operator: Operator;
  readMounted: () => MountedVault[];
  /**
   * Change the registry, by handing over a change rather than a result.
   *
   * The mutator runs against the list as it is at the moment of writing, which
   * is not the list this flow decided on: a folder picker and a big-folder
   * warning sit between the two, and another client mounting something in that
   * window used to be erased without a word. Backed by the locked
   * updateMountedVaults in @markbase/protocol.
   */
  updateMounted: (
    next: (current: MountedVault[]) => MountedVault[]
  ) => Promise<MountedVault[]>;
  /** The vault id a folder is marked with, or null. */
  markerOf: (dir: string) => string | null;
  /** How many markdown files a folder holds — what a mount would adopt. */
  countMarkdown: (dir: string) => number;
  /**
   * Begin syncing. Deliberately not awaited by this flow: mounting is
   * registration, and the first pass is open-ended work behind that answer.
   */
  startSync: (vault: MountedVault) => void;
  /** Where first vaults are proposed to live. */
  defaultHome?: string;
}

export type MountVaultResult =
  | { ok: true; dir: string }
  | { ok: false; reason: "canceled" | "declined" | "refused" };

/**
 * What to tell someone whose folder was refused.
 *
 * This used to say "Vaults can't be nested — pick a separate folder", which is
 * not the rule and never was. A folder carrying its own marker mounts inside
 * another vault every time someone drags one in Finder; checkMount allows it on
 * purpose, because identity beats location. What is actually refused here is an
 * UNMARKED folder, and the reason is narrower and more useful: those files
 * already belong to the other vault.
 *
 * The three overlaps are three different mistakes, so they get three different
 * answers. A folder INSIDE a vault is asking for a convert — promoting a folder
 * to a vault of its own, which is the one thing mounting cannot do. A folder
 * that CONTAINS a vault is just too wide. And a folder that IS another vault's
 * folder has lost its marker, which is worth saying plainly rather than
 * describing as an overlap.
 */
function refusal(verdict: Exclude<MountVerdict, { ok: true }>): string {
  if (verdict.reason === "other-vault") {
    return (
      "That folder already belongs to another vault. Pick an empty folder, " +
      "or one belonging to the vault you chose."
    );
  }
  const { clashName, clashDir } = verdict;
  switch (verdict.relation) {
    case "inside":
      // Deliberately does not say "go and convert it": converting exists as an
      // API route (POST /api/v1/vaults/convert) with no button anywhere in the
      // web app or the desktop. Naming the operation tells someone why mounting
      // is the wrong tool; sending them to look for a control that does not
      // exist would be a worse dead end than the vague message this replaced.
      return (
        `Those files are already part of "${clashName}" (${clashDir}), so they sync there ` +
        `today — two vaults can't sync the same files. Pick a folder outside "${clashName}". ` +
        `(Making this folder a vault of its own is a convert, which is a different operation ` +
        `from mounting.)`
      );
    case "contains":
      return (
        `That folder contains "${clashName}" (${clashDir}), so syncing it would sync that ` +
        `vault's files a second time. Pick a folder that doesn't contain another vault.`
      );
    case "same":
      return (
        `That is "${clashName}"'s own folder (${clashDir}), but its marker is missing — ` +
        `so it looks like an ordinary folder from here. Mount "${clashName}" there again ` +
        `rather than pointing a second vault at it.`
      );
  }
}

/** The same directory, however it was spelled (trailing separator, `..`). */
function sameFolder(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const abs = resolve(p);
    return abs.length > 1 && abs.endsWith(sep) ? abs.slice(0, -1) : abs;
  };
  return norm(a) === norm(b);
}

/**
 * Why `vaultId` may not live in `dir` — the sentence to show — or null when it
 * may. Two refusals, in the order a person should hear them:
 *
 * The home itself is not a vault. ~/Markbase is where every vault gets a
 * folder of its own — the first one, the Shared Vault, whatever is mounted
 * next — so a vault rooted there would swallow them all, and the overlap
 * check would start refusing every later mount. Refused by name, so the
 * message says what the folder is.
 *
 * Then the overlap check: a folder carrying this vault's own marker is allowed
 * even inside another vault — that is how you repoint one that moved — and
 * anything else that is, holds or sits inside another vault is refused.
 *
 * Exported so a folder can be checked BEFORE the vault exists: the desktop's
 * New Vault dialog picks the folder first and creates the row after, and the
 * refusal has to come at the pick, or the row is created and the folder is
 * refused afterwards, which reads as "it told me no and did it anyway". For a
 * vault that does not exist yet, pass an id no marker can carry.
 */
export function folderRefusal(
  dir: string,
  vaultId: string,
  name: string,
  mounted: MountedVault[],
  markerOf: (dir: string) => string | null,
  defaultHome?: string
): string | null {
  if (defaultHome && sameFolder(dir, defaultHome)) {
    return (
      `${defaultHome} is where your vaults live, one folder each — it can't be a vault itself. ` +
      `Pick a folder inside it (for example ${defaultHome}/${name}).`
    );
  }
  const verdict = checkMount(dir, vaultId, mounted, markerOf);
  return verdict.ok ? null : refusal(verdict);
}

export async function mountVault(
  input: MountVaultInput,
  deps: MountVaultDeps
): Promise<MountVaultResult> {
  const { operator, readMounted, updateMounted, markerOf, countMarkdown, startSync } = deps;
  const mounted = readMounted();

  // Already has a home here. Asking again is how one vault ends up with two.
  const already = mounted.find((m) => m.vaultId === input.vaultId);
  if (already) return { ok: true, dir: already.dir };

  let dir = input.dir ?? input.defaultDir;
  if (!dir) {
    const picked = await operator.chooseFolder({
      purpose: `Choose a folder for "${input.name}"`,
      startAt: input.isFirstVault ? deps.defaultHome : undefined,
    });
    if (!picked) return { ok: false, reason: "canceled" };
    dir = picked;
  }

  // Say the number before doing the work, not after.
  const found = countMarkdown(dir);
  if (found > ADOPT_WARN_AT) {
    const go = await operator.approve({
      action: `That folder holds ${found} markdown files`,
      detail:
        `Mounting uploads every one of them as a document in "${input.name}". ` +
        `If you meant a folder of notes, this is probably the wrong folder — ` +
        `a source repository or a home directory looks like this.`,
      confirmLabel: `Sync all ${found}`,
    });
    if (!go) return { ok: false, reason: "declined" };
  }

  const refused = folderRefusal(dir, input.vaultId, input.name, mounted, markerOf, deps.defaultHome);
  if (refused) {
    operator.reportEvent({ level: "error", message: refused });
    return { ok: false, reason: "refused" };
  }

  const vault: MountedVault = { vaultId: input.vaultId, name: input.name, dir };
  if (input.ownerId) vault.ownerId = input.ownerId;
  // Filtered by id, not appended: re-mounting is how a vault is pointed
  // somewhere new, and the entry to replace is whichever one is in the registry
  // now — callers pass a readMounted that already hides this vault, so the old
  // entry is invisible up there but still very much on disk.
  await updateMounted((current) => [
    ...current.filter((m) => m.vaultId !== vault.vaultId),
    vault,
  ]);
  startSync(vault);
  return { ok: true, dir };
}
