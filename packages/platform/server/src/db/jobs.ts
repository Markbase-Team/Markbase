// The database half of @markbase/shared/jobs: every query here runs on the web
// server with the secret key. The shapes these return stay in @markbase/shared.

import { supabase } from "../supabase";
import type { JobKind, JobPayload, Job, WorkerPresence } from "@markbase/shared/jobs";

// Enqueue a job for the local worker to pick up.
export async function createJob(
  ticketId: string,
  kind: JobKind = "dispatch",
  payload?: JobPayload
): Promise<Job> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({ ticket_id: ticketId, kind, payload: payload ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data as Job;
}

// True if the ticket already has a job waiting or in progress.
export async function hasPendingJob(ticketId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("ticket_id", ticketId)
    .in("status", ["queued", "running"]);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Fetch a single job by id (worker uses this to detect cancellation mid-run).
export async function getJob(id: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Job | null;
}

// The same, scoped to an owner: what the worker API serves. A job belongs to
// the owner of its ticket (jobs.owner_id, set by trigger), and a worker's key
// resolves to exactly one owner, so another owner's job is simply not found.
export async function getOwnedJob(ownerId: string, id: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Job | null;
}

// Heartbeat a running job: bump claimed_at so the staleness sweep
// (reclaim_stale) doesn't reclaim a long-but-healthy run. No-op if the job is
// no longer running (e.g. it was canceled).
export async function heartbeatJob(id: string): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "running");
  if (error) throw error;
}

// Cancel any queued/running jobs for a ticket. A queued job is never claimed;
// a running job is detected by the worker's poll, which kills the subprocess.
// Returns how many jobs were affected.
export async function cancelTicketJobs(ticketId: string): Promise<number> {
  const { data, error } = await supabase
    .from("jobs")
    .update({ status: "canceled", finished_at: new Date().toISOString() })
    .eq("ticket_id", ticketId)
    .in("status", ["queued", "running"])
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

// Atomically claim the next queued job (worker). Returns null if none.
// PostgREST returns a composite of NULLs (not JS null) when the function
// returns NULL, so guard on the id.
export async function claimNextJob(
  ownerId: string,
  version?: string
): Promise<Job | null> {
  // Passing the version also records worker presence (last_poll_at) for this
  // owner — see the workers table + claim_next_job RPC.
  const { data, error } = await supabase.rpc("claim_next_job", {
    p_owner_id: ownerId,
    p_version: version ?? null,
  });
  if (error) throw error;
  const job = data as Job | null;
  return job && job.id ? job : null;
}

export async function getWorkerPresence(
  ownerId: string,
  staleMs = 15_000
): Promise<WorkerPresence> {
  const { data, error } = await supabase
    .from("workers")
    .select("last_poll_at, worker_version")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  const lastPollAt = data?.last_poll_at ?? null;
  const connected =
    !!lastPollAt && Date.now() - new Date(lastPollAt).getTime() < staleMs;
  return { connected, lastPollAt, version: data?.worker_version ?? null };
}

// Run the staleness sweep (also scheduled server-side via pg_cron).
export async function reclaimStale(): Promise<void> {
  const { error } = await supabase.rpc("reclaim_stale");
  if (error) throw error;
}

export async function finishJob(
  id: string,
  status: "done" | "error",
  errorMessage?: string
): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({
      status,
      error: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}
