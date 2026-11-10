import { authorizedByGate } from "@markbase/protocol/caller";
import { readerDocumentHandler } from "../../../../../../handlers";

type Ctx = { params: Promise<{ id: string }> };

const handler = readerDocumentHandler(authorizedByGate);

export async function GET(req: Request, { params }: Ctx) {
  return handler.GET(req, (await params).id);
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handler.PATCH(req, (await params).id);
}

export async function DELETE(req: Request, { params }: Ctx) {
  return handler.DELETE(req, (await params).id);
}
