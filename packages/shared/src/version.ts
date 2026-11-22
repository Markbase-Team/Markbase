// Minimum @markbase/cli worker version that can fulfil agent auto-spawn (it's
// the version that drains agent_spawn_requests). Bump when a feature needs a
// newer worker.
export const MIN_SPAWN_WORKER_VERSION = "0.7.5";

/**
 * The first worker build that reaches the database only through the web API
 * (security lockdown stage 2). A worker older than this still talks to
 * PostgREST with the publishable key, which the `worker_public_access` switch
 * in docs.app_config keeps open until every worker reports at least this —
 * and refuses once it is turned off. The Agents page reads this to say which.
 */
export const MIN_WORKER_VERSION = "0.8.0";

export const CLI_PACKAGE = "@markbase/cli";

// The newest published CLI, or null if the registry is unreachable. Never throws:
// both callers (the worker's nudge, `markbase update`) treat "unknown" as "don't
// bother the user".
export async function fetchLatestCliVersion(): Promise<string | null> {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${CLI_PACKAGE}/latest`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// True when `current` is strictly older than `target` (both "a.b.c"). Unparseable
// input returns false, so a missing/odd version never triggers a false "outdated".
export function isVersionBehind(
  current: string | null | undefined,
  target: string
): boolean {
  const c = parseSemver(current ?? "");
  const t = parseSemver(target);
  if (!c || !t) return false;
  for (let i = 0; i < 3; i++) {
    if (c[i] < t[i]) return true;
    if (c[i] > t[i]) return false;
  }
  return false;
}
