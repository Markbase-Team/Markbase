import { callerFromHeaders } from "@markbase/protocol/auth";
import {
  createManualItem,
  fileEmailOnBoard,
  type AttentionPriority,
} from "../../../../../server";

const PRIORITIES: AttentionPriority[] = ["high", "medium", "low"];
function isPriority(v: string | null | undefined): v is AttentionPriority {
  return (PRIORITIES as string[]).includes(v ?? "");
}

// POST /api/v1/attention/items — add a card to a board. Two shapes:
//   - manual: { board_id, subject, summary?, priority? }
//   - from an email: { board_id, account_id, message_id, from, subject, ... }
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) {
    return Response.json({ error: "Missing credentials." }, { status: 401 });
  }

  let body: {
    board_id?: string;
    subject?: string;
    summary?: string;
    priority?: string | null;
    account_id?: string;
    message_id?: string;
    thread_id?: string | null;
    from?: string;
    snippet?: string;
    date?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const board_id = typeof body.board_id === "string" ? body.board_id : "";
  if (!board_id) {
    return Response.json({ error: "board_id is required" }, { status: 400 });
  }

  // Email-backed card when an account + message id are supplied.
  if (body.account_id && body.message_id) {
    const item = await fileEmailOnBoard({
      board_id,
      account_id: body.account_id,
      message_id: body.message_id,
      thread_id: typeof body.thread_id === "string" ? body.thread_id : null,
      from: typeof body.from === "string" ? body.from : "",
      subject: typeof body.subject === "string" ? body.subject : "(no subject)",
      snippet: typeof body.snippet === "string" ? body.snippet : "",
      date: typeof body.date === "string" ? body.date : "",
    });
    return Response.json({ item }, { status: 201 });
  }

  // Otherwise a manual card.
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) {
    return Response.json({ error: "A title is required" }, { status: 400 });
  }
  const item = await createManualItem({
    board_id,
    subject,
    summary: typeof body.summary === "string" ? body.summary.trim() : "",
    priority: isPriority(body.priority) ? body.priority : null,
  });
  return Response.json({ item }, { status: 201 });
}
