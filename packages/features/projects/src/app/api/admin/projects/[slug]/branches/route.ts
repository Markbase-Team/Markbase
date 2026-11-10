import { gateHost, projectBranchesHandler } from "../../../../../../handlers";

const handler = projectBranchesHandler(gateHost);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  return handler(req, (await params).slug);
}
