import { gateHost, projectMcpHandler } from "../../../../../../handlers";

const handler = projectMcpHandler(gateHost);

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handler.GET(req, (await params).slug);
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handler.PATCH(req, (await params).slug);
}
