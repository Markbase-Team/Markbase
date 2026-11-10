import { termHandler } from "../../../../../handlers";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: Ctx) {
  return termHandler.DELETE(req, (await params).id);
}
