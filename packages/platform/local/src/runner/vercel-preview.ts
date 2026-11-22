import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Resolve the live Vercel preview URL for a repo's branch, by reading the
// GitHub Deployment that Vercel creates (its status `environment_url` is the
// live preview). Uses the already-authenticated `gh` CLI, run inside the local
// repo so it infers owner/repo — no Vercel token needed.
//
// Returns the preview URL, or null if Vercel isn't set up / not ready yet.
export async function resolvePreviewUrl(
  cwd: string,
  branch: string
): Promise<string | null> {
  const gh = (args: string[]) =>
    exec("gh", args, { cwd, timeout: 20_000 }).then((r) => r.stdout.trim());

  try {
    // Head commit of the branch (the SHA Vercel deploys).
    const sha = (await exec("git", ["rev-parse", branch], { cwd })).stdout.trim();
    const repo = await gh([
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "-q",
      ".nameWithOwner",
    ]);
    if (!repo) return null;

    // Preview deployment for that SHA (fall back to the latest preview).
    let depId = await gh([
      "api",
      `repos/${repo}/deployments?sha=${sha}&environment=Preview`,
      "-q",
      ".[0].id // empty",
    ]);
    if (!depId) {
      depId = await gh([
        "api",
        `repos/${repo}/deployments?environment=Preview`,
        "-q",
        ".[0].id // empty",
      ]);
    }
    if (!depId) return null;

    // The successful status carries the live preview URL.
    const url = await gh([
      "api",
      `repos/${repo}/deployments/${depId}/statuses`,
      "-q",
      'map(select(.state == "success")) | .[0].environment_url // .[0].target_url // empty',
    ]);
    return url || null;
  } catch {
    return null;
  }
}
