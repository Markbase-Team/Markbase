import { gateHost, workerAgentRequestFinishHandler } from "../../../../../../../handlers";

const handler = workerAgentRequestFinishHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
