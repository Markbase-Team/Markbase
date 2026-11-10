import { gateHost, workerAgentRequestClaimHandler } from "../../../../../../../handlers";

const handler = workerAgentRequestClaimHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
