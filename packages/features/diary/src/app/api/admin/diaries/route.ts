import { authorizedByGate } from "@markbase/protocol/caller";
import { diariesHandler } from "../../../../handlers";

// Authentication and CORS happen in the shell's proxy — /api/admin/diaries is
// a required prefix there. These files are the URL, and nothing else.
const handler = diariesHandler(authorizedByGate);

export const GET = handler.GET;
export const POST = handler.POST;
