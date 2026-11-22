import { authorizedByGate } from "@markbase/shared/caller";
import { readerHighlightsHandler } from "../../../../../handlers";

export const POST = readerHighlightsHandler(authorizedByGate).POST;
