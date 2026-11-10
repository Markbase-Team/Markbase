import { attentionClassifyHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

// POST — classify a dropped email and file it onto the best-matching board.
export const POST = attentionClassifyHandler(authorizedByGate);
