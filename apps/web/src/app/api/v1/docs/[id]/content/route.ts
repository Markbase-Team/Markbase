import { docContentHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return docContentHandler(req, (await params).id);
}
