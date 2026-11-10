import { callerFromHeaders } from "@markbase/protocol/auth";
import { createDiary, listDiaries } from "../../../../server";

// Authentication and CORS happen in the shell's proxy — /api/v1/learnings is
// a required prefix there, so the caller it attached is never missing here;
// the null check is the routing-bug guard, not a sign-in flow.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/v1/learnings — diary entries (newest first).
export async function GET(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  const learnings = (await listDiaries(caller.ownerId)).map((d) => ({
    id: d.id,
    entry_date: d.entry_date,
    title: d.title,
    content: d.content,
  }));
  return Response.json({ learnings });
}

// POST /api/v1/learnings  { content, title?, entry_date? } — add a learning as a
// dated diary entry. entry_date defaults to today.
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  let body: { content?: string; title?: string; entry_date?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.content !== "string" || !body.content.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }
  const entry_date =
    typeof body.entry_date === "string" ? body.entry_date.trim() : "";
  if (entry_date && !DATE_RE.test(entry_date)) {
    return Response.json({ error: "entry_date must be YYYY-MM-DD" }, { status: 400 });
  }

  const learning = await createDiary(
    {
      entry_date: entry_date || undefined,
      title: typeof body.title === "string" ? body.title : "",
      content: body.content,
    },
    caller.ownerId
  );
  return Response.json({ learning }, { status: 201 });
}
