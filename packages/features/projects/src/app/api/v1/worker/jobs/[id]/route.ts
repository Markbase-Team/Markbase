import { gateHost, workerJobHandler } from "../../../../../../handlers";

const handler = workerJobHandler(gateHost);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handler.GET(req, (await params).id);
}
