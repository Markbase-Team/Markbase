import { vaultHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return vaultHandler.GET(req, (await params).id);
}

export async function PATCH(req: Request, { params }: Ctx) {
  return vaultHandler.PATCH(req, (await params).id);
}

export async function DELETE(req: Request, { params }: Ctx) {
  return vaultHandler.DELETE(req, (await params).id);
}
