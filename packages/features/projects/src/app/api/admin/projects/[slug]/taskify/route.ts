import { gateHost, projectTaskifyHandler } from "../../../../../../handlers";

const handler = projectTaskifyHandler(gateHost);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  return handler(req, (await params).slug);
}
