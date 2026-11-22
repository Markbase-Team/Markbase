import { gateHost, workerProjectRepoHandler } from "../../../../../../../handlers";

const handler = workerProjectRepoHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  return handler(req, (await params).slug);
}
