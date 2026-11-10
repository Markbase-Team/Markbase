import { attentionMoveFeedbackHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

// POST — a drag between boards; the model tunes both boards' rules.
export const POST = attentionMoveFeedbackHandler(authorizedByGate);
