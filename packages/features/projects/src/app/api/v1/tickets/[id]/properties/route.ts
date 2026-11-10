import { gateHost, ticketPropertiesHandler } from "../../../../../../handlers";

const handler = ticketPropertiesHandler(gateHost);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
