import { callerFromHeaders } from "@markbase/protocol/auth";
import { runUnsubscribe } from "@markbase/browser-agent";
import { getEmailAccount, getMessage } from "../../../../../server";

// POST { account, id } — spin up the unsubscribe agent for a message. Looks up
// the message's unsubscribe targets, then hands them to @markbase/browser-agent
// (one-click POST, else a headless-browser walk-through, else mailto).
// The browser agent can take a while to click through a confirmation page, so
// the manifest gives this route `maxDuration: 60`.
export async function POST(req: Request): Promise<Response> {
  const caller = callerFromHeaders(req.headers);
  if (!caller) {
    return Response.json({ error: "Missing credentials." }, { status: 401 });
  }

  let body: { account?: string; id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { account: accountId, id } = body;
  if (!accountId || !id) {
    return Response.json(
      { error: "account and id are required" },
      { status: 400 }
    );
  }

  const account = await getEmailAccount(accountId);
  if (!account) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }

  try {
    const message = await getMessage(account, id);
    const result = await runUnsubscribe(message.unsubscribe);
    return Response.json({ result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unsubscribe failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
