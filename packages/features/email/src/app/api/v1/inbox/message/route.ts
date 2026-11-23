import { inboxMessageHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/shared/caller";

export const GET = inboxMessageHandler(authorizedByGate);
