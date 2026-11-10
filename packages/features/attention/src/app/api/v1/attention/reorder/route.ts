import { attentionReorderHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

// POST — persist a board's card order after a drag-and-drop.
export const POST = attentionReorderHandler(authorizedByGate);
