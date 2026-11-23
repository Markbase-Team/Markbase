// Normalize a remote GitHub reference into a clonable URL.
// Accepts "owner/repo", "github.com/owner/repo", a full https URL, or git@ SSH.
// Pure string work: the web server uses it on what a person typed, the worker
// on what git reports.
export function normalizeRemote(input: string): string | null {
  const trimmed = input.trim().replace(/\.git$/, "");
  if (!trimmed) return null;

  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`;
  }
  const m = trimmed.match(/github\.com[/:]([\w.-]+\/[\w.-]+)/i);
  if (m) return `https://github.com/${m[1]}`;
  if (/^(https?:\/\/|git@)/.test(trimmed)) return trimmed;

  return null;
}
