import { attentionCreateBoardHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

// POST — create a new attention board.
export const POST = attentionCreateBoardHandler(authorizedByGate);
