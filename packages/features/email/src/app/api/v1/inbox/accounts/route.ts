import { inboxAccountsHandler } from "../../../../../handlers";
import { authorizedByGate } from "@markbase/shared/caller";

export const GET = inboxAccountsHandler(authorizedByGate);
