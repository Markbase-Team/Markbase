import {
  derivedDoc,
  docToMarkdown,
  emptyDoc,
  getMarkdown,
  markdownToDoc,
  type DocJSON,
  retitleLeadingH1,
  setMarkdown,
} from "../logic";
import {
  createDocument,
  deleteDocumentGroup,
  ensureDefaultVault,
  getDocument,
  listDocumentsForUser,
  listSharedDocumentsForUser,
  listTabs,
  ownerDisplayName,
  pathFollowingTitle,
  readDocCrdt,
  removeMember,
  renameDocument,
  reviveForFile,
  setDocumentPath,
  setMemberPath,
  editDocCrdt,
  userOwnsVault,
  type SharedDocumentListRow,
} from "../server";
import { normalizePath } from "@markbase/protocol/folders";
import { sharedDocPath } from "@markbase/protocol/shared-vault";
import { accountActor, requireDocEndpoint } from "./actor";
import { json } from "./respond";

/**
 * The shared list, as the Shared Vault daemon and the "Shared with me" tree
 * read it. Alongside the row: the caller's `capability` (the daemon writes a
 * viewer's file read-only), the `owner_name` the default layout is built from,
 * and a `path` that is the MEMBER's — their own filing, or
 * `<owner name>/<title>.md` until they move it. The owner's path travels as
 * `owner_path`: it is what their markdown's relative image links resolve
 * against, and it is nothing a member's folder should be shaped by.
 */
async function sharedListEntry(d: SharedDocumentListRow, withContent: boolean) {
  const ownerName = await ownerDisplayName(d.owner_id);
  return {
    id: d.id,
    title: d.title,
    ...(withContent ? { content: d.content } : {}),
    path: d.member_path ?? sharedDocPath(ownerName, d.title),
    member_path: d.member_path,
    owner_path: d.path,
    owner_name: ownerName,
    capability: d.capability,
    has_crdt: d.has_crdt,
    vault_id: d.vault_id,
    version: d.version,
    owner_id: d.owner_id,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

export const docsHandler = {
  // GET — list the docs the caller can see (owned + member of).
  GET: async (req: Request): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;

    // ?vault=<id> scopes the list to one vault (the daemon syncs a single
    // vault to a single folder). Omitted = everything the caller can see.
    const params = new URL(req.url).searchParams;
    const vaultId = params.get("vault") ?? undefined;
    // ?scope=shared lists only docs shared WITH the caller (member, not
    // owner) — ones that live in someone else's vault and so never appear in
    // a vault-scoped list. It's the data behind the "Shared with me" view.
    const scope = params.get("scope");
    // ?content=1 includes each doc's markdown. Opt-in because only the vault
    // daemon needs it — to seed a document the cloud has no CRDT for yet (one
    // created through this very endpoint, whose content lives in the row).
    // Every other caller wants a lean list, and the list query only selects
    // `content` when it's asked for (the bodies dwarf the rest of the row).
    const withContent = params.get("content") === "1";
    if (scope === "shared") {
      const shared = await listSharedDocumentsForUser(a.userId, withContent);
      return json({ docs: await Promise.all(shared.map((d) => sharedListEntry(d, withContent))) });
    }
    const docs = await listDocumentsForUser(a.userId, vaultId, withContent);
    // Omit the (potentially large) doc_json from the list view.
    return json({
      docs: docs.map((d) => ({
        id: d.id,
        title: d.title,
        ...(withContent ? { content: d.content } : {}),
        // The vault reads this to place the file in its folder; null = root.
        path: d.path,
        vault_id: d.vault_id,
        version: d.version,
        owner_id: d.owner_id,
        created_at: d.created_at,
        updated_at: d.updated_at,
      })),
    });
  },

  // POST — create a doc, optionally seeded with markdown `content`.
  POST: async (req: Request): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;

    let body: {
      title?: string;
      content?: string;
      path?: string;
      vault_id?: string;
      /** This file was found in a vault folder — it may be one we had. */
      adopt?: boolean;
    } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine — creates a blank doc
    }

    // The vault the document goes into must be the caller's. Checked before
    // anything else — before the revive lookup, which reads that vault's trash,
    // and before the insert — because the row's owner_id comes from the caller
    // while its vault_id comes from the body, and nothing else ties the two
    // together. Without this a daemon running under the wrong account's key
    // created 116 documents inside another account's vaults (see
    // userOwnsVault). A vault that does not exist reads the same as someone
    // else's: either way it is not a place this caller may create in.
    if (body.vault_id && !(await userOwnsVault(body.vault_id, a.userId))) {
      return json({ error: "You don't own that vault." }, 403);
    }

    // A file appearing in a vault is not always a new document. It can be one
    // that left and came back — a git branch switch is the ordinary case —
    // and creating it afresh would strand its comments, its share links and
    // its history on an id nothing points at any more. Only for adoption: a
    // document created through the app is new by definition.
    if (body.adopt && body.vault_id && body.path) {
      const revived = await reviveForFile({
        vaultId: body.vault_id,
        path: body.path,
        content: body.content ?? "",
      });
      if (revived) return json({ doc: revived.doc, revived: revived.by }, 200);
    }

    const doc = body.content?.trim() ? markdownToDoc(body.content) : emptyDoc();
    const created = await createDocument({
      title: body.title,
      doc_json: doc.toJSON(),
      content: docToMarkdown(doc),
      owner_id: a.userId,
      // A file adopted from a vault folder keeps its path, so it stays put on
      // the next sync instead of being pulled back to the root.
      path: body.path,
      // Every document must live in a vault or it syncs to no folder at all.
      vault_id: body.vault_id ?? (await ensureDefaultVault(a.userId)).id,
    });
    return json({ doc: created }, 201);
  },
};

export const documentHandler = {
  // GET — the document (canonical doc_json + markdown export + the caller's
  // capability).
  GET: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_readDoc");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    // `?derive=0` — answer WITHOUT opening the CRDT.
    //
    // Deriving means loading the snapshot, restoring a Y.Doc, and projecting
    // it to markdown + doc_json. Agents and the CLI need exactly that: it's
    // the only way they see current content. The browser editor does not — it
    // loads the same snapshot itself and overwrites whatever we send the
    // moment it binds — so for that caller this is a slow round trip whose
    // result is discarded.
    //
    // What it still gets is the row's own `content`, which costs nothing (it
    // came with the row) and is the one thing the editor genuinely needs from
    // us: the seed for a document whose cloud CRDT is still empty. In exactly
    // that case the row IS the truth. `doc_json` comes back as an empty
    // document rather than the row's copy — the row's is a mirror that only
    // server-side edits refresh, so it can be days behind, and painting it
    // would show stale text that then jumps.
    const derive = new URL(req.url).searchParams.get("derive") !== "0";

    const [tabs, derived] = await Promise.all([
      listTabs(auth.doc.tab_group_id),
      derive
        ? readDocCrdt(id, auth.doc.content, (doc) => ({
            content: getMarkdown(doc),
            doc_json: derivedDoc(doc),
          }))
        : Promise.resolve({
            content: auth.doc.content,
            doc_json: emptyDoc().toJSON() as DocJSON,
          }),
    ]);

    return json({
      doc: { ...auth.doc, content: derived.content, doc_json: derived.doc_json },
      capability: auth.capability,
      tabs,
    });
  },

  // PATCH — rename (editors+).
  PATCH: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_renameDoc");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    let body: { title?: string; path?: string | null; syncHeading?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const hasTitle =
      typeof body.title === "string" && body.title.trim().length > 0;
    // `path` moves the doc within the vault (a folder rename/move lands
    // here); null puts it back at the root. Distinct from absent, which means
    // "leave it".
    const hasPath = body.path === null || typeof body.path === "string";
    if (!hasTitle && !hasPath) {
      return json({ error: "title or path is required" }, 400);
    }

    if (hasTitle) {
      const title = (body.title as string).trim();
      await renameDocument(id, title);
      // A rename made deliberately (the sidebar's pencil) reaches the document's
      // leading h1, so the title on the left and the heading on the right agree.
      // Only on request: the editor's own heading→title rename must NOT write
      // the heading back, or a title that was stale by the time it arrived would
      // overwrite what the person went on typing.
      if (body.syncHeading === true) {
        await editDocCrdt(id, auth.doc.content, (doc) => {
          const markdown = getMarkdown(doc);
          const next = retitleLeadingH1(markdown, title);
          if (next !== markdown) setMarkdown(doc, next);
        });
      }
      // Cloud-first "rename renames the file": the path (hence the filename on
      // disk, via the vault daemon) follows the title, keeping the doc in its
      // folder — unless the caller ALSO sent an explicit path, which is a move
      // and wins.
      if (!hasPath) {
        const doc = await getDocument(id);
        await setDocumentPath(id, pathFollowingTitle(doc?.path ?? null, title));
      }
    }
    if (hasPath) {
      const next = typeof body.path === "string" ? body.path.trim() : null;
      await setDocumentPath(id, next && next.length > 0 ? next : null);
    }
    return json({ ok: true });
  },

  // DELETE — owner only. Deletes the whole logical document (every tab in its
  // group).
  DELETE: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_deleteDoc");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    await deleteDocumentGroup(id);
    return json({ ok: true });
  },
};

/**
 * The caller's own membership of a document: how THEY file it, and whether
 * they keep it at all. Both are the member's business alone — the owner's
 * document is untouched — which is why they live beside the document's
 * endpoints rather than inside PATCH / DELETE /docs/:id, where the same verbs
 * mean "move the owner's file" and "trash the document".
 *
 * Viewer suffices: any member may file or leave a share. The owner has no
 * membership to speak of, and a capped key is still the owner's key — so the
 * owner is told so rather than quietly matched to nothing.
 */
export const docMembershipHandler = {
  // PATCH { path } — where this document sits in the caller's Shared Vault.
  // A string moves it; null returns it to the default layout.
  PATCH: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_setMemberPath");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!auth.actor.userId || auth.doc.owner_id === auth.actor.userId) {
      return json({ error: "You own this document; move it with PATCH /docs/:id instead." }, 400);
    }

    let body: { path?: string | null } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (body.path !== null && typeof body.path !== "string") {
      return json({ error: "path (string or null) is required" }, 400);
    }
    const next = typeof body.path === "string" ? normalizePath(body.path) : null;
    const ok = await setMemberPath(id, auth.actor.userId, next && next.length > 0 ? next : null);
    if (!ok) return json({ error: "Document not found." }, 404);
    return json({ ok: true, path: next });
  },

  // DELETE — leave the share. The document stays exactly as it was for the
  // owner and every other member.
  DELETE: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_leaveShare");
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!auth.actor.userId || auth.doc.owner_id === auth.actor.userId) {
      return json({ error: "You own this document; delete it with DELETE /docs/:id instead." }, 400);
    }
    const ok = await removeMember(id, auth.actor.userId);
    if (!ok) return json({ error: "Document not found." }, 404);
    return json({ ok: true });
  },
};
