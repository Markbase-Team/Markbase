import { gateHost, projectPropertyHandler } from "../../../../../../../handlers";

const handler = projectPropertyHandler(gateHost);

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { slug, id } = await params;
  return handler.PATCH(req, slug, id);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { slug, id } = await params;
  return handler.DELETE(req, slug, id);
}
