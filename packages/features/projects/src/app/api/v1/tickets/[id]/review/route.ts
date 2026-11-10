import { gateHost, ticketReviewHandler } from "../../../../../../handlers";

const handler = ticketReviewHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
