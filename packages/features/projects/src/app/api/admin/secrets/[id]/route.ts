import { deleteSecret, updateSecret } from "../../../../../server";
import { callerFromHeaders } from "@markbase/protocol/auth";

// PATCH /api/admin/secrets/:id — rename, edit description, or rotate the value.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;

  let body: { name?: string; description?: string; value?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const secret = await updateSecret(
      id,
      {
        name: typeof body.name === "string" ? body.name.trim() : undefined,
        description:
          typeof body.description === "string"
            ? body.description.trim()
            : undefined,
        value: typeof body.value === "string" ? body.value : undefined,
      },
      caller.ownerId
    );
    if (!secret) {
      return Response.json({ error: "Secret not found" }, { status: 404 });
    }
    return Response.json({ secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update secret";
    const conflict = /duplicate key|unique/i.test(message);
    return Response.json(
      { error: conflict ? "A secret with that name already exists" : message },
      { status: conflict ? 409 : 500 }
    );
  }
}

// DELETE /api/admin/secrets/:id — remove a secret.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;
  await deleteSecret(id, caller.ownerId);
  return Response.json({ ok: true });
}
