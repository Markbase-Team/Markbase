import { callerFromHeaders } from "@markbase/protocol/auth";
import { getEmailAccount, markMessageRead } from "@markbase/email/server";
import { clearBoard, isManualItem } from "../../../../../../../server";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/v1/attention/boards/:id/clear — remove all cards from a board
// and mark each card's email as read in Gmail (manual cards have no email, so
// they're skipped). Undo re-files the cards, but can't un-read them.
export async function POST(req: Request, { params }: Ctx) {
  // The gate already authenticated this request; a missing caller behind a
  // `required` prefix is a routing bug, refused rather than served.
  const caller = callerFromHeaders(req.headers);
  if (!caller) {
    return Response.json({ error: "Missing credentials." }, { status: 401 });
  }
  const { id } = await params;

  let cleared;
  try {
    cleared = await clearBoard(id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to clear board";
    return Response.json({ error: msg }, { status: 500 });
  }

  // Mark each real email read, best-effort. Cache accounts so we fetch each
  // one (and its token) once even across many items.
  const accounts = new Map<string, Awaited<ReturnType<typeof getEmailAccount>>>();
  await Promise.all(
    cleared
      .filter((it) => it.account_id && !isManualItem(it))
      .map(async (it) => {
        const accountId = it.account_id as string;
        try {
          if (!accounts.has(accountId)) {
            accounts.set(accountId, await getEmailAccount(accountId));
          }
          const account = accounts.get(accountId);
          if (account) await markMessageRead(account, it.message_id);
        } catch {
          // best-effort: a read-only account or transient Gmail error is fine
        }
      })
  );

  return Response.json({ ok: true, cleared: cleared.length });
}
