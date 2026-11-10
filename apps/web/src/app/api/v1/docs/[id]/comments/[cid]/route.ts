import { docCommentHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const { id, cid } = await params;
  return docCommentHandler.PATCH(req, id, cid);
}
