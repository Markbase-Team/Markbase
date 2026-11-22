import { oauthCallbackHandler } from "../../../../../../handlers";
import { authorizedByGate } from "@markbase/shared/caller";

export const GET = oauthCallbackHandler(authorizedByGate);
