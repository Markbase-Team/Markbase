import { authorizedByGate } from "@markbase/protocol/caller";
import { readerDocumentsHandler } from "../../../../../handlers";

// Authentication and CORS happen in the shell's proxy — /api/v1/reader is a
// required prefix there. These files are the URL, and nothing else.
const handler = readerDocumentsHandler(authorizedByGate);

export const GET = handler.GET;
export const POST = handler.POST;
