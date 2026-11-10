import { gateHost, projectPropertiesHandler } from "../../../../../../handlers";

const handler = projectPropertiesHandler(gateHost);

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handler.GET(req, (await params).slug);
}

export async function POST(req: Request, { params }: Ctx) {
  return handler.POST(req, (await params).slug);
}
