import { docLinksHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return docLinksHandler.GET(req, (await params).id);
}

export async function POST(req: Request, { params }: Ctx) {
  return docLinksHandler.POST(req, (await params).id);
}
