import { docAtHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return docAtHandler(req, (await params).id);
}
