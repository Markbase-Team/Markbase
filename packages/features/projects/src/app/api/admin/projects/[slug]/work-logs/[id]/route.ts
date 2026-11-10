import { gateHost, workLogHandler } from "../../../../../../../handlers";

const handler = workLogHandler(gateHost);

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return handler.PATCH(req, (await params).id);
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handler.DELETE(req, (await params).id);
}
