import { inboxAccountsHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

export const GET = inboxAccountsHandler(authorizedByGate);
