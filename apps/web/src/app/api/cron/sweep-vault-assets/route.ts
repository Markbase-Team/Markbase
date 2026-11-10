import { sweepOrphanAssets } from "@markbase/docs/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// GET — invoked nightly by the Vercel cron (see apps/web/vercel.json) to delete
// vault asset objects nothing references any more.
//
// Why this has to exist: deleting a vault cascades its `assets` rows away in
// Postgres and never tells Storage, so the bytes leak forever. No foreign key can
// reach a blob store, and Supabase refuses direct SQL deletes on storage tables —
// a periodic sweep is the only answer, as it is for every system with an external
// blob store.
//
// `?dry=1` reports what WOULD go without deleting anything, which is how to look
// before leaping at real user data.
//
// Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron requests; reject
// anything else so a stranger can't drive our garbage collector.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dry = new URL(request.url).searchParams.get("dry") === "1";
  try {
    const { orphans, removed } = await sweepOrphanAssets({ commit: !dry });
    return Response.json({ dryRun: dry, found: orphans.length, removed, orphans });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sweep failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
