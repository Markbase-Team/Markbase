import { oauthStartHandler } from "../../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

export const GET = oauthStartHandler(authorizedByGate);
