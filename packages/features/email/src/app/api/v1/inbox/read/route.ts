import { inboxMarkReadHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/shared/caller";

export const POST = inboxMarkReadHandler(authorizedByGate);
