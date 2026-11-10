import type { Authorize } from "@markbase/protocol/caller";
import { listEmailAccounts, getEmailAccount } from "../server/accounts";
import { listInbox, getMessage, markMessageRead } from "../server/gmail";

// Route-handler factories for the Inbox API. The host app injects its own auth
// check (e.g. Supabase getAdminUser) so the package stays framework-agnostic.
// Each returns a standard Web `Response`.

export type { Authorize };

// GET — connected accounts (no tokens).
export function inboxAccountsHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "read");
    if (!caller.ok) {
      return Response.json({ error: caller.error }, { status: caller.status });
    }
    return Response.json({ accounts: await listEmailAccounts() });
  };
}

// GET ?account=&pageToken= — live inbox page (sanitized summaries).
export function inboxListHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "read");
    if (!caller.ok) {
      return Response.json({ error: caller.error }, { status: caller.status });
    }
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("account");
    const pageToken = searchParams.get("pageToken") ?? undefined;
    if (!accountId) {
      return Response.json({ error: "account is required" }, { status: 400 });
    }
    const account = await getEmailAccount(accountId);
    if (!account) {
      return Response.json({ error: "Account not found" }, { status: 404 });
    }
    try {
      return Response.json(await listInbox(account, pageToken));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Gmail fetch failed";
      return Response.json({ error: message }, { status: 502 });
    }
  };
}

// GET ?account=&id= — full message for the reading pane.
export function inboxMessageHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "read");
    if (!caller.ok) {
      return Response.json({ error: caller.error }, { status: caller.status });
    }
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("account");
    const messageId = searchParams.get("id");
    if (!accountId || !messageId) {
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
      return Response.json({ message: await getMessage(account, messageId) });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Gmail fetch failed";
      return Response.json({ error: message }, { status: 502 });
    }
  };
}

// POST { account, id } — mark a message read (removes the UNREAD label).
export function inboxMarkReadHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "write");
    if (!caller.ok) {
      return Response.json({ error: caller.error }, { status: caller.status });
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
      await markMessageRead(account, id);
      return Response.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Gmail modify failed";
      return Response.json({ error: message }, { status: 502 });
    }
  };
}
