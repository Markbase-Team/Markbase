// Retrying a call to the cloud, and -- more important -- NOT retrying it.
//
// Shared by the two transports that talk to the cloud: the server's PostgREST
// calls (crdt-store.ts) and every client's calls to the web API (crdt-api.ts).
// Both answer in the same shape, `{ data, error, status }`, so one judgement of
// "is this worth another go" serves both.

/** The shape postgrest-js hands back on failure; the API transport mimics it. */
export interface DbError {
  message: string;
  code?: string;
  details?: string;
}

export interface DbResult<T> {
  data: T;
  error: DbError | null;
  status?: number;
}

/**
 * Postgres/PostgREST conditions that say "the server was busy or the link
 * wobbled", not "your request was wrong". Anything else — a foreign key
 * violation, a permission denial — will fail identically forever, and retrying
 * it only delays the report.
 */
const TRANSIENT_CODES = new Set([
  "08000", // connection exception
  "08003", // connection does not exist
  "08006", // connection failure
  "40001", // serialization failure
  "40P01", // deadlock detected
  "53300", // too many connections
  "57014", // statement timeout
  "PGRST002", // schema cache not loaded yet
]);

/**
 * Statuses worth another go. postgrest-js retries only 520 and 503, and only for
 * GET/HEAD/OPTIONS — a 429 or a 502 on our upsert is never retried by the library.
 * The web API answers with the same statuses for the same conditions.
 */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

/**
 * Is this worth trying again?
 *
 * A client-side transport failure carries NO code: postgrest-js populates
 * code/hint only for errors that came back from the service, so an empty code
 * means the request never got an answer — a dropped socket, a DNS blip, the
 * "TypeError: terminated" that took a document out of the vault mid-startup.
 * Those are exactly the ones another attempt fixes.
 */
export function isTransientDbError(error: DbError, status?: number): boolean {
  if (status !== undefined && TRANSIENT_STATUS.has(status)) return true;
  if (!error.code) return true; // no code = it never reached the service
  return TRANSIENT_CODES.has(error.code);
}

/** Attempts, and the pause before each retry. Kept short — a reconcile is 15s away. */
export const DB_MAX_ATTEMPTS = 3;
export function dbRetryDelay(attempt: number): number {
  return 200 * 2 ** attempt + Math.floor(Math.random() * 120);
}

/**
 * Run a cloud call, retrying only what deserves it.
 *
 * `save` is the reason this exists. It is an upsert keyed on the primary key, so
 * repeating it is harmless — but postgrest-js judges retryability by HTTP method
 * alone, and a POST is never retried however idempotent it happens to be. That
 * left the one write in the sync loop with no protection at all: a snapshot that
 * failed to upload was simply lost until something else edited the document.
 * The API transport inherits the same protection: its save is a merge, and a
 * merge repeated is the same merge.
 */
export async function retryingDb<T>(
  what: string,
  // PromiseLike, not Promise: a PostgrestBuilder is thenable but has no .catch.
  run: () => PromiseLike<DbResult<T>>,
  onRetry?: (attempt: number, message: string) => void,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms))
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let result: DbResult<T>;
    try {
      result = await run();
    } catch (thrown) {
      // Some failures arrive as exceptions rather than an error field.
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      result = { data: null as T, error: { message }, status: undefined };
    }
    if (!result.error) return result.data;

    const last = attempt >= DB_MAX_ATTEMPTS - 1;
    if (last || !isTransientDbError(result.error, result.status)) {
      throw new Error(`${what}: ${result.error.message}`);
    }
    onRetry?.(attempt + 1, result.error.message);
    await sleep(dbRetryDelay(attempt));
  }
}
