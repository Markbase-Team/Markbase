import { createTodo, isDay, listTodos } from "@markbase/protocol/todos";
import { callerFromHeaders } from "@markbase/protocol/auth";

// Authentication happens in the shell's proxy — /api/v1/todos is a `required`
// prefix there, so a request that reaches this file carries a caller. The
// check below is what makes that assumption visible.

// GET /api/v1/todos?day=YYYY-MM-DD — the day's todo list, in order.
export async function GET(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const day = new URL(req.url).searchParams.get("day");
  if (!isDay(day)) {
    return Response.json({ error: "Invalid day" }, { status: 400 });
  }
  const todos = await listTodos(day, caller.ownerId);
  return Response.json({ todos });
}

// POST /api/v1/todos — add a task to a day's list.
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  let body: { text?: string; day?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "Text is required" }, { status: 400 });
  }
  if (!isDay(body.day)) {
    return Response.json({ error: "Invalid day" }, { status: 400 });
  }

  const todo = await createTodo({ text, day: body.day, ownerId: caller.ownerId });
  return Response.json({ todo }, { status: 201 });
}
