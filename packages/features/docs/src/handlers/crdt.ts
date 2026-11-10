import { base64ToBytes, bytesToBase64 } from "../logic";
import {
  broadcastCrdt,
  listCrdtChanges,
  loadCrdtSnapshot,
  saveCrdtSnapshot,
} from "../server";
import { accountActor, requireDocEndpoint } from "./actor";
import { json } from "./respond";

// A document's CRDT state, over the API (security lockdown stage 2).
//
// These are the editor's plumbing, not the agent's: an agent edits through
// /edits and reads through GET /docs/:id, which derive from this same state.
// Every client that used to read and write docs.doc_crdt directly — the vault
// daemon, the desktop app, the browser — now comes through here, so that the
// capability check every other document endpoint makes applies to the one
// thing those endpoints were ultimately protecting.

/** The largest snapshot accepted, in base64 characters (~6 MB of state). */
const MAX_STATE_CHARS = 8 * 1024 * 1024;

export const docCrdtHandler = {
  // GET — the snapshot (viewer+). `?after=<version>` answers `unchanged` with
  // no state when the caller already holds that version or newer: a poller's
  // cheap "anything new?".
  GET: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_readCrdt");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const after = new URL(req.url).searchParams.get("after");
    const snap = await loadCrdtSnapshot(id);
    if (!snap) return json({ state: null, version: 0 });
    if (after !== null && Number(after) >= snap.version) {
      return json({ version: snap.version, unchanged: true });
    }
    return json({ state: bytesToBase64(snap.state), version: snap.version });
  },

  // POST { state } — merge the caller's snapshot into the stored one (editor+).
  // What the merge added is broadcast to the document's live channel, so a
  // browser with the document open sees a daemon's edit without polling.
  POST: async (req: Request, id: string): Promise<Response> => {
    const auth = await requireDocEndpoint(req, id, "docs_writeCrdt");
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    let body: { state?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (typeof body.state !== "string" || body.state.length === 0) {
      return json({ error: "state (base64) is required" }, 400);
    }
    if (body.state.length > MAX_STATE_CHARS) {
      return json({ error: "state is too large" }, 413);
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(body.state);
    } catch {
      return json({ error: "state is not base64" }, 400);
    }

    let saved;
    try {
      saved = await saveCrdtSnapshot(id, bytes);
    } catch (e) {
      // mergeSnapshot refuses bytes that are not a Yjs update. Everything else
      // — the cloud failing past the retry policy, a race lost six times — is
      // the server's fault, and said so.
      const message = e instanceof Error ? e.message : String(e);
      if (/lost the race|snapshot for/.test(message)) return json({ error: message }, 503);
      return json({ error: `state is not a Yjs update: ${message}` }, 400);
    }
    if (saved.changed && saved.delta) await broadcastCrdt(id, saved.delta);
    return json({ version: saved.version });
  },
};

export const docCrdtChangesHandler = {
  // GET ?since=<cursor>&vault=<id> | &scope=shared — which of the caller's
  // documents have a newer snapshot. `vault` is one of their own vaults;
  // `scope=shared` is the documents shared with them (their Shared Vault). One
  // or the other: a folder holds one or the other. Account-level: a share-link
  // guest is nobody here and polls its one document instead.
  GET: async (req: Request): Promise<Response> => {
    const a = await accountActor(req);
    if ("error" in a) return a.error;
    const params = new URL(req.url).searchParams;
    const since = params.get("since");
    const vault = params.get("vault") ?? undefined;
    const scope = params.get("scope");
    if (scope !== null && scope !== "shared") {
      return json({ error: "scope must be `shared` or absent" }, 400);
    }
    if (scope === "shared" && vault) {
      return json({ error: "scope=shared and vault are exclusive" }, 400);
    }
    try {
      return json(await listCrdtChanges(a.userId, since, scope === "shared" ? "shared" : { vaultId: vault }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return json({ error: message }, /ISO timestamp/.test(message) ? 400 : 503);
    }
  },
};
