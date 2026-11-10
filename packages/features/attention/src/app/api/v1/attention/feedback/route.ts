import { attentionFeedbackHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

// POST — dismissal feedback: the model revises a board's rules or creates one.
export const POST = attentionFeedbackHandler(authorizedByGate);
