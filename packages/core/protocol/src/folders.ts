// Vault folder structure (roadmap A5 / B-folders).
//
// A vault's folders live in the document paths themselves — "projects/2026/q1.md"
// — the same way Obsidian, git and iCloud all work. Nothing else stores the
// hierarchy, so nesting is free and there is ONE representation that the local
// disk, the web app, and electron all manipulate. Each surface only differs in
// how it *applies* the result: the worker re-keys a VaultSync per move, the web
// updates a document's path, electron reuses the vault.
//
// A directory can be empty, which paths alone can't express (git has the same
// gap), so empty folders are carried explicitly alongside the file paths.

/** A file move produced by a folder operation. */
export interface Move {
  from: string;
  to: string;
}

/** One folder in the tree the web/electron file tree renders. */
export interface FolderNode {
  /** Last path segment ("" for the root). */
  name: string;
  /** Full folder path ("" for the root). */
  path: string;
  folders: FolderNode[];
  /** Full paths of the documents directly in this folder. */
  files: string[];
}

/** Vault-relative, POSIX separators, no leading/trailing slash, no "." segments. */
export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".")
    .join("/");
}

/** The folder a file lives in — "a/b/c.md" → "a/b"; "c.md" → "". */
export function folderOf(filePath: string): string {
  const norm = normalizePath(filePath);
  const i = norm.lastIndexOf("/");
  return i === -1 ? "" : norm.slice(0, i);
}

/** The path for a new file in a folder ("" = vault root). */
export function filePathIn(folder: string, filename: string): string {
  const f = normalizePath(folder);
  return f ? `${f}/${normalizePath(filename)}` : normalizePath(filename);
}

/** True when `folder` is `ancestor` or nested inside it (segment-aware). */
function isWithin(folder: string, ancestor: string): boolean {
  if (ancestor === "") return true;
  return folder === ancestor || folder.startsWith(`${ancestor}/`);
}

/** Every folder implied by the file paths, plus any explicitly-created (possibly
 *  empty) ones — including intermediates — deduped and sorted. */
export function listFolders(files: string[], explicit: string[] = []): string[] {
  const out = new Set<string>();
  const addChain = (folder: string): void => {
    const segs = normalizePath(folder).split("/").filter(Boolean);
    for (let i = 1; i <= segs.length; i++) out.add(segs.slice(0, i).join("/"));
  };
  for (const f of files) addChain(folderOf(f));
  for (const f of explicit) addChain(f);
  return [...out].sort();
}

/** Build the nested tree (root node has name/path ""). */
export function buildFolderTree(files: string[], explicit: string[] = []): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: [], files: [] };
  const ensure = (folder: string): FolderNode => {
    if (folder === "") return root;
    let node = root;
    let acc = "";
    for (const seg of folder.split("/")) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = node.folders.find((f) => f.name === seg);
      if (!next) {
        next = { name: seg, path: acc, folders: [], files: [] };
        node.folders.push(next);
        node.folders.sort((a, b) => a.name.localeCompare(b.name));
      }
      node = next;
    }
    return node;
  };
  for (const folder of listFolders(files, explicit)) ensure(folder);
  for (const file of files) ensure(folderOf(file)).files.push(normalizePath(file));
  return root;
}

/** Every file under a folder, including nested ones (segment-aware, so "proj"
 *  never matches "projects"). Order follows the input. */
export function filesUnder(files: string[], folder: string): string[] {
  const f = normalizePath(folder);
  return files.map(normalizePath).filter((p) => isWithin(folderOf(p), f));
}

/** Rewrite every file under `folder` so the folder now sits at `destFolder`. */
function rewriteTo(files: string[], folder: string, destFolder: string): Move[] {
  return filesUnder(files, folder).map((from) => ({
    from,
    to: destFolder ? `${destFolder}/${from.slice(folder.length + 1)}` : from.slice(folder.length + 1),
  }));
}

/** Rename a folder in place (same parent). Returns the file moves to apply. */
export function renameFolder(files: string[], folder: string, newName: string): Move[] {
  const f = normalizePath(folder);
  if (newName.includes("/") || newName.includes("\\")) {
    throw new Error(`Folder name cannot contain a path separator: "${newName}"`);
  }
  // A folder path reads like a file path, so folderOf() gives its parent:
  // "projects/2026" → "projects"; "archive" → "" (root).
  const parent = folderOf(f);
  const dest = parent ? `${parent}/${newName}` : newName;
  if (dest !== f && listFolders(files).includes(dest)) {
    throw new Error(`A folder named "${dest}" already exists`);
  }
  return rewriteTo(files, f, dest);
}

/**
 * Re-base every file under `folder` so that `folder` itself becomes a vault root:
 * "projects/2026/q1.md" with folder "projects" → "2026/q1.md".
 *
 * This is what CONVERTING a folder into its own vault means. A document's path is
 * vault-RELATIVE, so the paths can't simply come along — the folder that used to
 * be a prefix is now the root, and leaving it in would nest the whole vault one
 * level deep inside its own folder on every device.
 */
export function rebaseToVaultRoot(files: string[], folder: string): Move[] {
  const f = normalizePath(folder);
  if (f === "") throw new Error("Cannot convert the vault root into a vault");
  return rewriteTo(files, f, "");
}

/** Move a folder (and its whole subtree) under `newParent` ("" = vault root). */
export function moveFolder(files: string[], folder: string, newParent: string): Move[] {
  const f = normalizePath(folder);
  const parent = normalizePath(newParent);
  if (isWithin(parent, f)) {
    throw new Error(`Cannot move "${f}" into itself or its own descendant`);
  }
  const name = f.split("/").pop() as string;
  const dest = parent ? `${parent}/${name}` : name;
  if (dest !== f && listFolders(files).includes(dest)) {
    throw new Error(`A folder named "${dest}" already exists`);
  }
  return rewriteTo(files, f, dest);
}
