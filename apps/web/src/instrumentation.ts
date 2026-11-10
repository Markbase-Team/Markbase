import { DEFAULT_APP_URL, joinLink } from "@markbase/protocol/instance";

// Runs once when the server starts (Next's instrumentation hook).
//
// A fresh self-hosted instance has nobody on it to share its invite link, and
// the join page offers no sign-up without one. So the first link is printed
// here, the way Jenkins prints its first password: `docker compose logs web`
// (SELF-HOSTING.md, section 3). Not on the hosted app, whose sign-up is open.
//
// Tried more than once: an instance usually starts right after its database
// — `docker compose up` on a machine that just ran the migrations, a stack
// whose PostgREST is still reloading its schema cache — and a link that was
// "not available yet" at second one is available at second ten. Giving up
// at the first failure left the log without a link at all.
const ATTEMPTS = 10;
const RETRY_MS = 3000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const url = process.env.APP_URL?.replace(/\/+$/, "") ?? `http://localhost:${process.env.PORT ?? 3000}`;
  if (url === DEFAULT_APP_URL) return;
  // Imported here, not at the top: the module brings in the Supabase client,
  // which must not load in the edge runtime's copy of this file.
  const { inviteCode } = await import("@/lib/invite");
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const printed = await inviteCode().then(
      (code) => {
        console.log(`Invite link: ${joinLink(url, code)}`);
        return true;
      },
      (e: Error) => {
        const last = attempt === ATTEMPTS;
        console.log(
          `Invite link: not available yet (${e.message})${last ? "" : ` — trying again in ${RETRY_MS / 1000}s`}`
        );
        return false;
      }
    );
    if (printed) return;
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}
