import { termAskHandler } from "../../../../../../handlers";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return termAskHandler.POST(req, (await params).id);
}
