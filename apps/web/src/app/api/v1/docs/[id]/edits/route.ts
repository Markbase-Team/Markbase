import { docEditsHandler } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return docEditsHandler(req, (await params).id);
}
