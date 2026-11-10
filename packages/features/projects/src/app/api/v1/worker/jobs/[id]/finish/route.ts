import { gateHost, workerJobFinishHandler } from "../../../../../../../handlers";

const handler = workerJobFinishHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler(req, (await params).id);
}
