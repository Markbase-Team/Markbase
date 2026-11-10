import { docMembershipHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return docMembershipHandler.PATCH(req, (await params).id);
}

export async function DELETE(req: Request, { params }: Ctx) {
  return docMembershipHandler.DELETE(req, (await params).id);
}
