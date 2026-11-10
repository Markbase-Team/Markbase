import { gateHost, projectHandler } from "../../../../../handlers";

const handler = projectHandler(gateHost);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  return handler.PATCH(req, (await params).slug);
}
