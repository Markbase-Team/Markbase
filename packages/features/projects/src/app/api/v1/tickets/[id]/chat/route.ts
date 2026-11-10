import { gateHost, ticketChatHandler } from "../../../../../../handlers";

const handler = ticketChatHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
