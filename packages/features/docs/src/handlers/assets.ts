import { createHash } from "node:crypto";
import { normalizePath } from "@markbase/protocol/folders";
import { refsIn } from "@markbase/protocol/asset-refs";
import { assetPathFor } from "../logic";
import {
  listAssets,
  putAsset,
  signAssetUrl,
  userOwnsVault,
  type AssetRow,
} from "../server";
import { accountActor, requireDocCapability } from "./actor";
import { json, empty } from "./respond";

// Media in a vault (roadmap A6).
//
// The markdown only ever says `![d](assets/diagram.png)`. These endpoints are
// how a surface turns that path into bytes: GET lists a vault's assets with
// signed URLs to render, POST stores an upload and answers with the path to
// write into the markdown.

/** The caller must own the vault — otherwise they could read or seed anyone's. */
const ownedVault = userOwnsVault;

type AssetSummary = Record<string, string | number | null>;

const summary = (a: AssetRow, url: string | null): AssetSummary => ({
  path: a.path,
  sha256: a.sha256,
  size_bytes: a.size_bytes,
  content_type: a.content_type,
  url,
});

async function withUrl(a: AssetRow): Promise<AssetSummary> {
  // Time-limited: the bucket is private precisely so a leaked link expires.
  return summary(a, await signAssetUrl(a.vault_id, a.sha256));
}

/**
 * A tag for this answer: changes when any asset is added, removed, moved or
 * replaced, and differs between the with-URLs and without-URLs forms. The sync
 * daemon asks every 15 s and nearly always gets "no change" — answered with a
 * 304 and no signing, which on 2026-09-13 was ~60% of the database's traffic.
 */
function listTag(assets: AssetRow[], withUrls: boolean): string {
  const h = createHash("sha256").update(withUrls ? "urls\n" : "bare\n");
  for (const a of assets) h.update(`${a.path}\0${a.sha256}\n`);
  return `"${h.digest("base64url")}"`;
}

/**
 * The assets ONE document's markdown references, out of its vault's.
 *
 * A member of a shared document may read the document, and a document is its
 * images as much as its words — but the vault around it is the owner's, and
 * listing the whole vault's media to a member would hand them every picture in
 * every document the owner never shared. So the member gets exactly what the
 * document asks for: the paths its markdown resolves to, resolved against the
 * OWNER's path for it (the same rule the daemon applies, from the same code),
 * matched against the vault's index. The row's `content` mirror is what is
 * parsed; it trails a live edit by a save, which costs a member an image for a
 * moment and the owner nothing.
 */
function referencedBy(docPath: string | null, markdown: string, vaultAssets: AssetRow[]): AssetRow[] {
  const wanted = new Set(refsIn(docPath ?? "untitled.md", markdown));
  return vaultAssets.filter((a) => wanted.has(a.path));
}

export const assetsHandler = {
  // GET ?vault=<id> — every asset in the vault, each with a signed URL.
  // `urls=0` leaves the URLs out (url: null) for callers that only diff the
  // list. Honors If-None-Match: an unchanged list is a 304.
  //
  // GET ?doc=<id> — the assets one document references, for anyone who may
  // READ that document (a member of a shared document, say, who owns no part
  // of its vault). Same shape, same tag, same 304.
  GET: async (req: Request): Promise<Response> => {
    const params = new URL(req.url).searchParams;
    const vaultId = params.get("vault");
    const docId = params.get("doc");
    if (vaultId && docId) return json({ error: "vault and doc are exclusive" }, 400);
    if (!vaultId && !docId) return json({ error: "vault or doc is required" }, 400);

    let assets: AssetRow[];
    if (docId) {
      // Viewer, like reading the document: an image is part of the text. Not a
      // registry endpoint of its own — it is /assets, scoped by a query, and the
      // registry keys per-document routes by path.
      const auth = await requireDocCapability(req, docId, "viewer");
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      // A document with no vault has no media to list — never an error.
      assets = auth.doc.vault_id
        ? referencedBy(auth.doc.path, auth.doc.content, await listAssets(auth.doc.vault_id))
        : [];
    } else {
      const a = await accountActor(req);
      if ("error" in a) return a.error;
      if (!(await ownedVault(vaultId as string, a.userId))) {
        return json({ error: "Vault not found" }, 404);
      }
      assets = await listAssets(vaultId as string);
    }

    const withUrls = params.get("urls") !== "0";
    const etag = listTag(assets, withUrls);
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (req.headers.get("if-none-match") === etag) {
      return empty(304, headers);
    }
    const body = withUrls
      ? await Promise.all(assets.map(withUrl))
      : assets.map((row) => summary(row, null));
    return json({ assets: body }, 200, headers);
  },

  // POST — store an upload. multipart/form-data: file, vault_id, and an
  // optional path (omit it and we file the image under assets/ for you).
  POST: async (req: Request): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ error: "Expected multipart/form-data" }, 400);
    }

    const file = form.get("file");
    const vaultId = form.get("vault_id");
    if (!(file instanceof File)) return json({ error: "file is required" }, 400);
    if (typeof vaultId !== "string" || !vaultId) {
      return json({ error: "vault_id is required" }, 400);
    }
    if (!(await ownedVault(vaultId, a.userId))) {
      return json({ error: "Vault not found" }, 404);
    }

    // A caller-supplied path is honoured (the daemon uploading a file the user
    // already filed); otherwise we pick a free name under assets/, which is
    // the convention Obsidian and most markdown tooling expect.
    const wanted = form.get("path");
    const existing = (await listAssets(vaultId)).map((x) => x.path);
    const path =
      typeof wanted === "string" && wanted.trim()
        ? normalizePath(wanted)
        : assetPathFor(file.name, existing);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = await putAsset({
      vaultId,
      ownerId: a.userId,
      path,
      bytes,
      contentType: file.type || undefined,
    });

    // `path` is what the caller writes into the markdown — never the URL.
    return json({ asset: await withUrl(asset) }, 201);
  },
};
