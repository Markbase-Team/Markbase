import {
  deleteTicket,
  getProjectTicket,
  updateTicket,
} from "@markbase/protocol/tickets";

// Public requester path: scoped to the project in the URL. getProjectTicket
// returns the ticket only if it belongs to this project; we thread its own
// owner_id to the scoped writes so they target that exact row.
async function ownedByProject(id: string, project: string) {
  return getProjectTicket(id, project);
}

// PATCH /api/projects/:project/tickets/:id — requester edits their ticket.
// Requesters may only change the descriptive fields, not owner/status.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ project: string; id: string }> }
) {
  const { project, id } = await params;
  const ticket = await ownedByProject(id, project);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  let body: {
    title?: string;
    requester?: string;
    description?: string;
    images?: string[];
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, requester, description, images } = body;

  const imageUrls = Array.isArray(images)
    ? images.filter(
        (u): u is string => typeof u === "string" && /^https?:\/\//.test(u)
      )
    : undefined;

  const updated = await updateTicket(
    id,
    {
      title: typeof title === "string" ? title.trim() : undefined,
      requester: typeof requester === "string" ? requester.trim() : undefined,
      description:
        typeof description === "string" ? description.trim() : undefined,
      images: imageUrls,
    },
    ticket.owner_id ?? ""
  );

  return Response.json({ ticket: updated });
}

// DELETE /api/projects/:project/tickets/:id — requester deletes their ticket.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ project: string; id: string }> }
) {
  const { project, id } = await params;
  const ticket = await ownedByProject(id, project);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }
  await deleteTicket(id, ticket.owner_id ?? "");
  return Response.json({ ok: true });
}
