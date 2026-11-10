import { authorizedByGate } from "@markbase/protocol/caller";
import { readerHighlightsHandler } from "../../../../../handlers";

export const POST = readerHighlightsHandler(authorizedByGate).POST;
