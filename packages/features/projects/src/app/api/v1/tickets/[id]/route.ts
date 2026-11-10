import { gateHost, ticketHandler } from "../../../../../handlers";

const handler = ticketHandler(gateHost);

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handler.GET(req, (await params).id);
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handler.PATCH(req, (await params).id);
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handler.DELETE(req, (await params).id);
}
