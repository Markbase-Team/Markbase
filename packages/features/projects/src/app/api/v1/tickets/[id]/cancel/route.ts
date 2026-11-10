import { gateHost, ticketCancelHandler } from "../../../../../../handlers";

const handler = ticketCancelHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
