import { authorizedByGate } from "@markbase/shared/caller";
import { readerAskHandler } from "../../../../../handlers";

export const POST = readerAskHandler(authorizedByGate).POST;
