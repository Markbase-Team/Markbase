import { authorizedByGate } from "@markbase/protocol/caller";
import { readerMessageHandler } from "../../../../../../handlers";

type Ctx = { params: Promise<{ id: string }> };

const handler = readerMessageHandler(authorizedByGate);

export async function DELETE(req: Request, { params }: Ctx) {
  return handler.DELETE(req, (await params).id);
}
