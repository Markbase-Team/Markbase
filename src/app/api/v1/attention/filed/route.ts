import { attentionFiledHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/shared/caller";

// GET — Gmail message ids already filed onto an Attention board.
export const GET = attentionFiledHandler(authorizedByGate);
