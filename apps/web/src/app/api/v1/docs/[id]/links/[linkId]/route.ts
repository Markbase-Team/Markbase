import { docLinkHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id, linkId } = await params;
  return docLinkHandler.DELETE(req, id, linkId);
}
