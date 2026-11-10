import { gateHost, projectsHandler } from "../../../../handlers";

const handler = projectsHandler(gateHost);

export const GET = handler.GET;
export const POST = handler.POST;
