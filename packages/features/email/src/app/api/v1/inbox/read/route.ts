import { inboxMarkReadHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

export const POST = inboxMarkReadHandler(authorizedByGate);
