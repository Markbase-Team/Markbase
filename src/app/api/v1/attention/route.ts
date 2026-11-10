import { attentionBoardsHandler } from "../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

// Authentication happens in the shell's proxy — /api/v1/attention is a
// `required` prefix there. These files are the URL, and nothing else.

// GET — all boards + filed items for the Attention page.
export const GET = attentionBoardsHandler(authorizedByGate);
