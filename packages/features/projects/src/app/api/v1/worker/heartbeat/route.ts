import { gateHost, workerHeartbeatHandler } from "../../../../../handlers";

export const POST = workerHeartbeatHandler(gateHost);
