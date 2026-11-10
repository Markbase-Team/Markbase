import { inboxMessageHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

export const GET = inboxMessageHandler(authorizedByGate);
