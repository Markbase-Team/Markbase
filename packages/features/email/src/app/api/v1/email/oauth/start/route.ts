import { oauthStartHandler } from "../../../../../../handlers";
import { authorizedByGate } from "@markbase/shared/caller";

export const GET = oauthStartHandler(authorizedByGate);
