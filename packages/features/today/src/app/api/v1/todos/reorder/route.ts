import { isDay, reorderTodos } from "@markbase/protocol/todos";
import { callerFromHeaders } from "@markbase/protocol/auth";

// POST /api/v1/todos/reorder — persist a drag-reordered day list.
// Body: { day: "YYYY-MM-DD", orderedIds: string[] } (top-to-bottom order).
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  let body: { day?: string; orderedIds?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isDay(body.day)) {
    return Response.json({ error: "Invalid day" }, { status: 400 });
  }
  if (
    !Array.isArray(body.orderedIds) ||
    !body.orderedIds.every((id) => typeof id === "string")
  ) {
    return Response.json({ error: "Invalid orderedIds" }, { status: 400 });
  }

  await reorderTodos(body.day, body.orderedIds, caller.ownerId);
  return Response.json({ ok: true });
}
