import { docAnalyticsHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return docAnalyticsHandler(req, (await params).id);
}
