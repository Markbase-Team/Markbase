import { attentionItemHandler } from "../../../../../../handlers";
import { authorizedByGate } from "@markbase/protocol/caller";

const handler = attentionItemHandler(authorizedByGate);

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/v1/attention/items/:id — approve in place, or move to a board.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handler.PATCH(req, id);
}

// DELETE /api/v1/attention/items/:id — dismiss an item.
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handler.DELETE(req, id);
}
