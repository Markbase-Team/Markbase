import { callerFromHeaders } from "@markbase/protocol/auth";
import {
  listEmailAccounts,
  getEmailAccount,
  listInbox,
} from "@markbase/email/server";

const MAX_RESULTS = 20;

export type EmailMatch = {
  account_id: string;
  message_id: string;
  thread_id: string | null;
  from: string;
  subject: string;
  snippet: string;
  date: string;
};

// POST /api/v1/attention/search  { query }
// Run a Gmail search across all connected accounts and return matches the user
// can file onto a board. (A raw Gmail web link can't be resolved to an API id,
// so we search instead.)
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) {
    return Response.json({ error: "Missing credentials." }, { status: 401 });
  }

  let body: { query?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return Response.json({ error: "A search query is required" }, { status: 400 });
  }

  const results: EmailMatch[] = [];
  for (const summary of await listEmailAccounts()) {
    if (results.length >= MAX_RESULTS) break;
    try {
      const account = await getEmailAccount(summary.id);
      if (!account) continue;
      const page = await listInbox(account, undefined, query);
      for (const m of page.messages) {
        results.push({
          account_id: account.id,
          message_id: m.id,
          thread_id: m.threadId,
          from: m.from,
          subject: m.subject,
          snippet: m.snippet,
          date: m.date,
        });
        if (results.length >= MAX_RESULTS) break;
      }
    } catch {
      // skip an account whose search failed (auth/scope/transient)
    }
  }

  return Response.json({ results });
}
