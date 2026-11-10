import { docCrdtChangesHandler } from "@markbase/docs/handlers";

// A static segment under /docs: Next resolves it ahead of /docs/[id], so this
// never reads as a document called "crdt".
export const runtime = "nodejs";

export const GET = docCrdtChangesHandler.GET;
