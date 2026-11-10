import { gateHost, ticketMessagesHandler } from "../../../../../../handlers";

const handler = ticketMessagesHandler(gateHost);

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handler.GET(req, (await params).id);
}

export async function POST(req: Request, { params }: Ctx) {
  return handler.POST(req, (await params).id);
}
