// The database half of @markbase/shared/worker-refresh: every query here runs
// on the web server with the secret key.

import { supabase } from "../supabase";
import {
  REFRESH_REQUEST_TTL_MS,
  type ProjectBranches,
  type RefreshKind,
  type RefreshRequests,
  type StoredProjectBranches,
} from "@markbase/shared/worker-refresh";

/**
 * Ask this owner's worker to look a ticket or a project up again. Asking twice
 * is one request: the row is keyed by what is asked for, and a repeat only
 * moves its time forward.
 */
export async function requestRefresh(
  ownerId: string,
  kind: RefreshKind,
  ref: string
): Promise<void> {
  const { error } = await supabase
    .from("worker_refresh_requests")
    .upsert(
      { owner_id: ownerId, kind, ref, requested_at: new Date().toISOString() },
      { onConflict: "owner_id,kind,ref" }
    );
  if (error) throw error;
}

/**
 * What this owner's worker is being asked for right now. Requests older than
 * the TTL are left out: no worker answered them, and offering them on every
 * poll for ever would cost a lookup each time.
 */
export async function listRefreshRequests(ownerId: string): Promise<RefreshRequests> {
  const since = new Date(Date.now() - REFRESH_REQUEST_TTL_MS).toISOString();
  const { data, error } = await supabase
    .from("worker_refresh_requests")
    .select("kind, ref")
    .eq("owner_id", ownerId)
    .gte("requested_at", since)
    .order("requested_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Array<{ kind: RefreshKind; ref: string }>;
  return {
    tickets: rows.filter((r) => r.kind === "ticket").map((r) => r.ref),
    projects: rows.filter((r) => r.kind === "project").map((r) => r.ref),
  };
}

/** The worker answered; stop asking. */
export async function clearRefreshRequest(
  ownerId: string,
  kind: RefreshKind,
  ref: string
): Promise<void> {
  const { error } = await supabase
    .from("worker_refresh_requests")
    .delete()
    .eq("owner_id", ownerId)
    .eq("kind", kind)
    .eq("ref", ref);
  if (error) throw error;
}

/** Store the branches a worker reported for a project, stamped with now. */
export async function saveProjectBranches(
  ownerId: string,
  slug: string,
  branches: ProjectBranches
): Promise<StoredProjectBranches> {
  const stored: StoredProjectBranches = {
    branches: branches.branches,
    default: branches.default,
    current: branches.current,
    at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("projects")
    .update({ branches: stored })
    .eq("slug", slug)
    .eq("owner_id", ownerId);
  if (error) throw error;
  return stored;
}

/** Forget a project's stored branches (its local path changed). */
export async function clearProjectBranches(ownerId: string, slug: string): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ branches: null })
    .eq("slug", slug)
    .eq("owner_id", ownerId);
  if (error) throw error;
}
