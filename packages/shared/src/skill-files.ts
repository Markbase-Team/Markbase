export interface SkillFile {
  id: string;
  skill_id: string;
  /** Relative POSIX path inside the skill dir, e.g. "scripts/validate.sh". */
  path: string;
  /** UTF-8 text content. */
  content: string;
  /** chmod +x on install (scripts) → mode 0755 vs 0644 in the bundle. */
  executable: boolean;
  created_at: string;
  updated_at: string;
}

export interface SkillFileInput {
  path: string;
  content?: string;
  executable?: boolean;
}

// A safe relative path: POSIX separators, no leading slash, no "." / ".."
// segments, no backslashes or control chars. Guards the installer (which writes
// each path under the skill dir) against traversal, and keeps SKILL.md reserved
// for the skill's own body.
export function isSafeSkillPath(path: string): boolean {
  if (typeof path !== "string") return false;
  const p = path.trim();
  if (!p || p.length > 255) return false;
  if (p.startsWith("/") || p.includes("\\")) return false;
  // Reject control characters and spaces in paths.
  if (/[\x00-\x1f ]/.test(p)) return false;
  const segments = p.split("/");
  return segments.every(
    (seg) => seg.length > 0 && seg !== "." && seg !== ".." && seg !== "SKILL.md"
  );
}
