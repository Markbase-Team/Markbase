import { authorizedByGate } from "@markbase/protocol/caller";
import { readerAskHandler } from "../../../../../handlers";

export const POST = readerAskHandler(authorizedByGate).POST;
