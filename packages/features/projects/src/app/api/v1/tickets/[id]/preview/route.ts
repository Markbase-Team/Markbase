import { gateHost, ticketPreviewHandler } from "../../../../../../handlers";

const handler = ticketPreviewHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
