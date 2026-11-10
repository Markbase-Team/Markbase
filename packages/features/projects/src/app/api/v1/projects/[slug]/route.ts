import { gateHost, projectHandler } from "../../../../../handlers";

const handler = projectHandler(gateHost);

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handler.GET(req, (await params).slug);
}
