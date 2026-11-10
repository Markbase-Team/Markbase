import { docDiffHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return docDiffHandler(req, (await params).id);
}
