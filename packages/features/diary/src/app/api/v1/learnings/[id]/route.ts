import { callerFromHeaders } from "@markbase/protocol/auth";
import { getDiary, updateDiary, deleteDiary } from "../../../../../server";

// Authentication and CORS happen in the shell's proxy — /api/v1/learnings is
// a required prefix there, so the caller it attached is never missing here;
// the null check is the routing-bug guard, not a sign-in flow.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Ctx = { params: Promise<{ id: string }> };

// PUT /api/v1/learnings/:id  { title?, content?, entry_date? } — update an
// existing learning. Only the provided fields change.
export async function PUT(req: Request, { params }: Ctx) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  const { id } = await params;
  if (!(await getDiary(id, caller.ownerId))) {
    return Response.json({ error: "Learning not found" }, { status: 404 });
  }

  let body: { title?: string; content?: string; entry_date?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: { title?: string; content?: string; entry_date?: string } = {};
  if (typeof body.content === "string") {
    if (!body.content.trim()) {
      return Response.json({ error: "content cannot be empty" }, { status: 400 });
    }
    patch.content = body.content;
  }
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.entry_date === "string") {
    if (!DATE_RE.test(body.entry_date.trim())) {
      return Response.json({ error: "entry_date must be YYYY-MM-DD" }, { status: 400 });
    }
    patch.entry_date = body.entry_date.trim();
  }
  if (Object.keys(patch).length === 0) {
    return Response.json(
      { error: "nothing to update (send content, title, or entry_date)" },
      { status: 400 }
    );
  }

  const learning = await updateDiary(id, patch, caller.ownerId);
  return Response.json({ learning });
}

// DELETE /api/v1/learnings/:id — remove a learning.
export async function DELETE(req: Request, { params }: Ctx) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  const { id } = await params;
  await deleteDiary(id, caller.ownerId);
  return Response.json({ ok: true });
}
