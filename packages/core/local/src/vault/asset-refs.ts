// Which media a document actually asks for.
//
// Moved to @markbase/protocol/asset-refs, where the API can share it: the
// member-aware asset listing (`GET /assets?doc=…`) must resolve references
// exactly as the daemon does, or an image the daemon wants is one the API
// withholds. Re-exported here because the daemon and its tests import it from
// the vault, and nothing about where it is used changed.

export { resolveRef, rawRefsIn, refsIn, referencedAssets } from "@markbase/protocol/asset-refs";
