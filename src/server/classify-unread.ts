import {
  listEmailAccounts,
  getEmailAccount,
  listInbox,
} from "@markbase/email/server";
import { classifyEmails, type ClassifyInput } from "./attention";

// Cap how many unread emails we sweep in one run so the request stays bounded.
const MAX_TOTAL = 150;

// Sweep every unread email across all connected accounts and link the results
// into Attention boards. Emails already linked to a board are skipped. Shared by
// the POST /api/v1/attention/classify-unread route and the daily cron — keep
// the sweep in one place.
export async function classifyUnreadEmails() {
  const accounts = await listEmailAccounts();
  const inputs: ClassifyInput[] = [];

  for (const summary of accounts) {
    if (inputs.length >= MAX_TOTAL) break;
    const account = await getEmailAccount(summary.id);
    if (!account) continue;

    let pageToken: string | undefined;
    do {
      const page = await listInbox(account, pageToken, "is:unread in:inbox");
      for (const m of page.messages) {
        inputs.push({
          account_id: account.id,
          message_id: m.id,
          thread_id: m.threadId,
          from: m.from,
          subject: m.subject,
          snippet: m.snippet,
          date: m.date,
        });
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && inputs.length < MAX_TOTAL);
  }

  return classifyEmails(inputs.slice(0, MAX_TOTAL));
}
