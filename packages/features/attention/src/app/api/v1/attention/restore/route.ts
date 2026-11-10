import { attentionRestoreHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

// POST — re-insert removed items (undo a board clear or dismissal).
export const POST = attentionRestoreHandler(authorizedByGate);
