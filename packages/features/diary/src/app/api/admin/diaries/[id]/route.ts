import { authorizedByGate } from "@markbase/protocol/caller";
import { diaryHandler } from "../../../../../handlers";

type Ctx = { params: Promise<{ id: string }> };

const handler = diaryHandler(authorizedByGate);

export async function PATCH(req: Request, { params }: Ctx) {
  return handler.PATCH(req, (await params).id);
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handler.DELETE(req, (await params).id);
}
