import { attentionBoardHandler } from "../../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

const handler = attentionBoardHandler(authorizedByGate);

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/v1/attention/boards/:id — edit board name/color/rules.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handler.PATCH(req, id);
}

// DELETE /api/v1/attention/boards/:id — remove board (+ its items).
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handler.DELETE(req, id);
}
