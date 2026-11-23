import { authorizedByGate } from "@markbase/shared/caller";
import { readerSelectionsHandler } from "../../../../../handlers";

export const POST = readerSelectionsHandler(authorizedByGate).POST;
