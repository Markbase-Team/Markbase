import { docCommentsHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return docCommentsHandler.GET(req, (await params).id);
}

export async function POST(req: Request, { params }: Ctx) {
  return docCommentsHandler.POST(req, (await params).id);
}
