import { docHistoryHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return docHistoryHandler(req, (await params).id);
}
