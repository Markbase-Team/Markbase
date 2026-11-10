import { authorizedByGate } from "@markbase/protocol/caller";
import { readerSelectionsHandler } from "../../../../../handlers";

export const POST = readerSelectionsHandler(authorizedByGate).POST;
