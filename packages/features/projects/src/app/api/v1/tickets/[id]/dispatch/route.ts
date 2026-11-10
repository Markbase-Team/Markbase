import { gateHost, ticketDispatchHandler } from "../../../../../../handlers";

const handler = ticketDispatchHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
