import { docTabHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; tabId: string }> }
) {
  const { id, tabId } = await params;
  return docTabHandler.DELETE(req, id, tabId);
}
