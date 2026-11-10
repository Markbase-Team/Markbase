import { deleteTodo, getTodo, updateTodo } from "@markbase/protocol/todos";
import { callerFromHeaders } from "@markbase/protocol/auth";

// PATCH /api/v1/todos/:id — toggle done, rename, or edit markdown details.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;
  if (!(await getTodo(id, caller.ownerId))) {
    return Response.json({ error: "Todo not found" }, { status: 404 });
  }

  let body: { text?: string; done?: boolean; details?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const todo = await updateTodo(
    id,
    {
      text:
        typeof body.text === "string" && body.text.trim()
          ? body.text.trim()
          : undefined,
      done: typeof body.done === "boolean" ? body.done : undefined,
      details:
        typeof body.details === "string" ? body.details.trim() : undefined,
    },
    caller.ownerId
  );
  return Response.json({ todo });
}

// DELETE /api/v1/todos/:id — remove a task.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;
  if (!(await getTodo(id, caller.ownerId))) {
    return Response.json({ error: "Todo not found" }, { status: 404 });
  }
  await deleteTodo(id, caller.ownerId);
  return Response.json({ ok: true });
}
