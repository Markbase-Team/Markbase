import { termMessageHandler } from "../../../../../../handlers";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  return termMessageHandler.DELETE(req, (await params).id);
}
