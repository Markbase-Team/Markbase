import { spawn } from "node:child_process";
import { ticketBranch } from "@markbase/protocol/tickets";
import type { Ticket } from "@markbase/protocol/types";

export interface ClaudeCodeResult {
  ok: boolean;
  sessionId: string | null;
  summary: string | null;
  error?: string;
}

// Handle for an in-flight session so callers can stop it (e.g. on cancel).
export interface ClaudeCodeSession {
  /** Terminate the underlying process. Safe to call more than once. */
  cancel: () => void;
}

// The fields we pull from a tool_use block's input to show what a step is doing.
interface ToolUseInput {
  command?: string; // Bash
  file_path?: string; // Edit / Write / Read
  path?: string; // some file tools
  pattern?: string; // Grep / Glob
  url?: string; // WebFetch
  description?: string; // Task
}

// Render a tool_use block as a one-line "what's happening now" string for the
// live stream, e.g. `Bash`: git checkout -b feature/… or `Edit`: src/app/x.tsx.
function summarizeToolUse(block: {
  name?: string;
  input?: ToolUseInput;
}): string {
  const name = block.name ?? "tool";
  const input = block.input ?? {};
  const detail =
    input.command ??
    input.file_path ??
    input.path ??
    input.pattern ??
    input.url ??
    input.description ??
    "";
  const trimmed = detail.replace(/\s+/g, " ").trim().slice(0, 140);
  return trimmed ? `\`${name}\`: ${trimmed}` : `\`${name}\``;
}

// Prompt lines pointing Claude at attached files ALREADY DOWNLOADED to local
// paths on this machine. It must open them with the Read tool, which renders
// images/PDFs into the conversation — they are not in the text prompt itself.
// Shared by the dispatch prompt and chat follow-ups. `paths` are absolute local
// file paths (the worker downloads the uploaded URLs before building the prompt).
function attachedFilesLines(paths: string[] | undefined): string[] {
  if (!paths?.length) return [];
  return [
    paths.length === 1
      ? "An image/PDF is attached to this request, downloaded to this machine. " +
        "You MUST view it with the Read tool before responding:"
      : "Images/PDFs are attached to this request, downloaded to this machine. " +
        "You MUST view each with the Read tool before responding:",
    ...paths.map((p) => `  - ${p}`),
    "",
  ];
}

// One line telling the session whether to commit + manage a PR after making
// changes, driven by the ticket's auto_commit toggle.
function commitDirective(
  autoCommit: boolean,
  progressUrl?: string,
  progressToken?: string
): string {
  if (!autoCommit) {
    return (
      "Make the change(s) but do NOT commit, push, or open a pull request — " +
      "leave them uncommitted in the working tree for review."
    );
  }
  const base =
    "When done, commit your change(s) and push the branch. If no pull request " +
    "is open for this branch yet, open one (gh pr create --base main --fill); " +
    "if a PR is already open, the push adds the commits to it.";
  if (!progressUrl) return base + " Then report the PR via the progress endpoint.";
  // State the current endpoint + auth explicitly so a resumed session uses it
  // instead of any (now-invalid) endpoint it saw earlier in the session.
  const authLine = progressToken
    ? `     -H "Authorization: Bearer ${progressToken}" \\\n`
    : "";
  return (
    base +
    " Then report the PR to the progress endpoint below — use exactly this URL " +
    "and header, ignoring any progress endpoint from earlier in the session:\n" +
    `   curl -s -X POST "${progressUrl}" \\\n` +
    authLine +
    `     -H "Content-Type: application/json" \\\n` +
    `     -d '{"pr_title":"<pr title>","pr_id":"<pr number>","pr_link":"<pr url>"}'`
  );
}

// Prompt for a chat follow-up that resumes an existing session: the user's
// message, any attached files (local paths) so Claude can Read them, and a
// directive on whether to commit/PR (per the ticket's auto_commit toggle).
// A follow-up prompt for an existing session. The session already has the
// original context, but the ticket's title/description may have been edited
// since the first run — so we re-send the current ones as the source of truth,
// matching what `buildPrompt` sends on dispatch.
export function buildChatPrompt(opts: {
  message: string;
  title?: string;
  description?: string;
  attachmentPaths?: string[];
  autoCommit?: boolean;
  progressUrl?: string;
  progressToken?: string;
}): string {
  const { message, title, description, attachmentPaths } = opts;
  const autoCommit = opts.autoCommit ?? true;
  const files = attachedFilesLines(attachmentPaths);
  const context =
    title || description
      ? [
          "Current ticket (it may have been updated since your last run — treat this as the source of truth):",
          ...(title ? [`Title: ${title}`] : []),
          ...(description ? ["", "Description:", description] : []),
          "",
          "Follow-up request:",
        ]
      : [];
  return [
    ...context,
    message,
    ...(files.length ? ["", ...files] : []),
    "",
    commitDirective(autoCommit, opts.progressUrl, opts.progressToken),
  ].join("\n");
}

// Build the task prompt handed to Claude Code from the ticket. `progressUrl`
// is the endpoint the session reports commits and the PR to. `attachmentPaths`
// are the ticket's images already downloaded to local files (the worker resolves
// them) so Claude can open them with the Read tool.
// The fixed opening of every dispatch prompt. Exported so session discovery can
// recognize the worker's own ticket-run sessions and title them by their ticket
// ("Ticket: <title>") instead of this identical boilerplate line.
export const TICKET_PROMPT_PREFIX =
  "You are completing a ticket from the";

export function buildPrompt(
  ticket: Ticket,
  projectName: string,
  progressUrl: string,
  attachmentPaths?: string[],
  // The worker's API key — sent as a bearer token so the progress endpoint can
  // authenticate the caller and scope writes to its owner's tickets.
  progressToken?: string
): string {
  // The branch to commit on: the ticket's explicit base_branch, or a fresh
  // ticket-aligned branch (feature/… or fix/…). Either way step 1 creates it
  // off main when it doesn't exist yet.
  const work = ticketBranch(ticket);
  // The curl auth line for the progress endpoint (empty when no token).
  const authLine = progressToken
    ? `     -H "Authorization: Bearer ${progressToken}" \\`
    : "";
  const authLines = authLine ? [authLine] : [];
  const header = [
    `You are completing a ticket from the "${projectName}" project, working in this git repository.`,
    "",
    `Title: ${ticket.title}`,
    "",
    "Description:",
    ticket.description,
    "",
    ...attachedFilesLines(attachmentPaths),
    `Work on the "${work}" branch.`,
    "",
    "Follow this workflow exactly:",
    "",
    `1. Switch to the "${work}" branch. If it already exists (locally or on`,
    `   origin), check it out and update it:`,
    `   \`git checkout ${work} && git pull --ff-only\` (ignore pull errors). If`,
    `   it does NOT exist, create it off main:`,
    `   \`git checkout main && git pull && git checkout -b ${work}\`. Always`,
    `   work on "${work}" — do not create any other branch.`,
    "",
  ];

  // When auto_commit is off, make the change but leave it uncommitted.
  const steps = ticket.auto_commit
    ? [
        "2. Implement the requested change. Break the work into multiple small,",
        "   logical commits, each with a clear message.",
        "",
        "3. After EACH commit, report it to the progress endpoint. Build the commit",
        "   link from the repo's GitHub URL and the commit SHA",
        "   (https://github.com/<owner>/<repo>/commit/<full-sha>):",
        "",
        `   curl -s -X POST "${progressUrl}" \\`,
        ...authLines,
        '     -H "Content-Type: application/json" \\',
        `     -d '{"commit_title":"<commit message>","commit_link":"<commit url>"}'`,
        "",
        `4. When finished, push the branch (\`git push -u origin ${work}\`). If no`,
        `   pull request is open for "${work}" yet, open one with`,
        `   \`gh pr create --base main --head ${work} --fill\`; if a PR is already`,
        "   open, the push adds the commits to it. Capture the PR number and URL",
        `   (\`gh pr view ${work} --json number,url\`).`,
        "",
        "5. Report the PR with a final request to the SAME endpoint:",
        "",
        `   curl -s -X POST "${progressUrl}" \\`,
        ...authLines,
        '     -H "Content-Type: application/json" \\',
        `     -d '{"pr_title":"<pr title>","pr_id":"<pr number>","pr_link":"<pr url>"}'`,
        "",
        "6. Finally, give a short summary of what you changed.",
      ]
    : [
        "2. Implement the requested change. Do NOT commit, push, or open a pull",
        "   request — leave the changes uncommitted in the working tree for review.",
        "",
        "3. Finally, give a short summary of what you changed.",
      ];

  return [...header, ...steps, "", `Progress endpoint: ${progressUrl}`].join(
    "\n"
  );
}

// Start a headless Claude Code session in `cwd` (the project's local repo) via
// the CLI's direct/print channel — an in-process subprocess, no chat app.
// Returns immediately. Pass a `sessionId` to know it up front (so callers can
// surface the running session before it finishes). Set `resume` to continue an
// existing session (a follow-up) instead of starting a fresh one. `onText`
// streams the agent's narration live; `onComplete` fires when the session exits.
export function startClaudeCodeSession(opts: {
  cwd: string;
  prompt: string;
  sessionId?: string;
  resume?: boolean;
  /**
   * Which Claude to run. A path, or a bare name for PATH to resolve; defaults
   * to `claude` on PATH, which is right for the CLI. The desktop app has no
   * user PATH to speak of — a GUI app launched from Finder sees the login
   * shell's PATH only by accident — and ships its own binary, so it passes
   * that path (see apps/app/src/claude-bin.ts).
   */
  claudeBin?: string;
  /** Project MCP config as a JSON string. Used with --strict-mcp-config so the
   *  run uses ONLY these servers (not the worker's global MCP setup). */
  mcpConfig?: string;
  /** Extra env for the subprocess — the resolved secret values that the MCP
   *  config references as ${NAME}. Claude expands them; they stay out of the
   *  config string and process args. */
  extraEnv?: Record<string, string>;
  onText?: (text: string) => void;
  onComplete: (result: ClaudeCodeResult) => void;
}): ClaudeCodeSession {
  const args = [
    "-p",
    opts.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
  ];
  // Resume an existing session with -r; otherwise pin a fresh session id.
  if (opts.resume && opts.sessionId) {
    args.push("-r", opts.sessionId);
  } else if (opts.sessionId) {
    args.push("--session-id", opts.sessionId);
  }
  // Per-project MCP servers — only these (strict), so a project's environment
  // (e.g. its own Supabase account) is isolated from the worker's global MCPs.
  if (opts.mcpConfig) {
    args.push("--mcp-config", opts.mcpConfig, "--strict-mcp-config");
  }

  let child;
  try {
    child = spawn(opts.claudeBin ?? "claude", args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.extraEnv ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    opts.onComplete({
      ok: false,
      sessionId: opts.sessionId ?? null,
      summary: null,
      error: e instanceof Error ? e.message : "Failed to launch claude",
    });
    return { cancel: () => {} };
  }

  let buf = "";
  let stderr = "";
  let narration = ""; // accumulated assistant text, streamed via onText
  let sessionId = opts.sessionId ?? null;
  let resultText: string | null = null;
  let isError = false;

  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.session_id) sessionId = ev.session_id;
      if (ev.type === "assistant" && ev.message?.content) {
        // Accumulate the full transcript (prose + tool activity) as a fallback
        // summary. For the LIVE status, stream only Claude's own latest prose —
        // its natural-language narration of what it's doing — with no per-tool
        // interpretation (works for any tool/MCP/plugin). During pure tool
        // stretches there's no new prose, so the last status stays and the
        // spinner conveys ongoing work. The clean final answer is `resultText`.
        let status = "";
        for (const block of ev.message.content) {
          if (block.type === "text" && block.text) {
            narration += (narration ? "\n\n" : "") + block.text;
            status = block.text.replace(/\s+/g, " ").trim().slice(0, 200);
          } else if (block.type === "tool_use") {
            narration += (narration ? "\n\n" : "") + summarizeToolUse(block);
          }
        }
        if (status) opts.onText?.(status);
      } else if (ev.type === "result") {
        isError = ev.is_error === true || ev.subtype === "error";
        if (typeof ev.result === "string") resultText = ev.result;
      }
    }
  });
  child.stderr.on("data", (d) => (stderr += d.toString()));

  child.on("error", (e) => {
    opts.onComplete({
      ok: false,
      sessionId,
      summary: narration || null,
      error: e.message,
    });
  });

  child.on("close", (code) => {
    if (code !== 0) {
      opts.onComplete({
        ok: false,
        sessionId,
        summary: narration || null,
        error: stderr.trim().slice(0, 4000) || `claude exited with code ${code}`,
      });
      return;
    }
    opts.onComplete({
      ok: !isError,
      sessionId,
      summary: (resultText ?? narration).slice(0, 8000) || null,
    });
  });

  return {
    cancel: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // already exited
      }
    },
  };
}
