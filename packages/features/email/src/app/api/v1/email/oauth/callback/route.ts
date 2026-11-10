import { oauthCallbackHandler } from "../../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

export const GET = oauthCallbackHandler(authorizedByGate);
