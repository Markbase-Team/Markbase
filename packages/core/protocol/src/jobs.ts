export type JobKind = "dispatch" | "chat";
export type JobStatus = "queued" | "running" | "done" | "error" | "canceled";

// Extra data carried by a job (e.g. the message for a chat follow-up).
export interface JobPayload {
  message?: string;
  /** Image/PDF URLs attached to a chat follow-up, for Claude to inspect. */
  images?: string[];
}

export interface Job {
  id: string;
  ticket_id: string;
  kind: JobKind;
  payload: JobPayload | null;
  status: JobStatus;
  error: string | null;
  created_at: string;
  claimed_at: string | null;
  finished_at: string | null;
}

// Whether an owner has a live worker. "connected" means it polled within
// staleMs (default 15s — 5× the 3s poll interval).
export interface WorkerPresence {
  connected: boolean;
  lastPollAt: string | null;
  version: string | null;
}
