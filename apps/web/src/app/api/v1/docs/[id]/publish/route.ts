import { docPublishHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return docPublishHandler.GET(req, (await params).id);
}

export async function POST(req: Request, { params }: Ctx) {
  return docPublishHandler.POST(req, (await params).id);
}

export async function DELETE(req: Request, { params }: Ctx) {
  return docPublishHandler.DELETE(req, (await params).id);
}
