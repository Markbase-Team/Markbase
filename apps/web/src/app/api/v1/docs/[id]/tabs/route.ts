import { docTabsHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return docTabsHandler.GET(req, (await params).id);
}

export async function POST(req: Request, { params }: Ctx) {
  return docTabsHandler.POST(req, (await params).id);
}

export async function PATCH(req: Request, { params }: Ctx) {
  return docTabsHandler.PATCH(req, (await params).id);
}
