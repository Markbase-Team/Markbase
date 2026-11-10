import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig } from "./config";

const exec = promisify(execFile);

async function hasCommand(cmd: string): Promise<boolean> {
  try {
    await exec("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

async function ghAuthed(): Promise<boolean> {
  try {
    await exec("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

// Verify the configured API key resolves to an owner via the web app.
async function keyResolves(
  appUrl: string,
  apiKey: string
): Promise<ToolResult> {
  if (!apiKey) return { ok: false, detail: "no API key configured" };
  try {
    const res = await fetch(`${appUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from ${appUrl}/api/v1/me` };
    const data = (await res.json()) as { owner_id?: string };
    return data.owner_id
      ? { ok: true, detail: `owner ${data.owner_id}` }
      : { ok: false, detail: "no owner_id in response" };
  } catch (e) {
    return { ok: false, detail: `cannot reach ${appUrl} (${String(e)})` };
  }
}

const isMac = process.platform === "darwin";
const brewHint = (pkgs: string) =>
  isMac ? `install with: brew install ${pkgs}` : `install ${pkgs} with your package manager`;

// ── Tools: each prerequisite the worker might use, checked once. ──────────────
type ToolId = "claude" | "apiKey" | "git" | "gh" | "ghAuth";

interface ToolResult {
  ok: boolean;
  /** Extra context for the label (e.g. which owner the key resolved to). */
  detail?: string;
}

interface ToolSpec {
  label: string;
  fix?: string;
  run: (env: Env) => Promise<ToolResult>;
}

interface Env {
  appUrl: string;
  apiKey: string;
}

const TOOLS: Record<ToolId, ToolSpec> = {
  claude: {
    label: "claude CLI installed",
    fix: "install Claude Code — https://docs.claude.com/claude-code",
    run: async () => ({ ok: await hasCommand("claude") }),
  },
  apiKey: {
    label: "API key resolves",
    fix: "run: markbase init  (and check the key/app URL)",
    run: (env) => keyResolves(env.appUrl, env.apiKey),
  },
  git: {
    label: "git installed",
    fix: brewHint("git"),
    run: async () => ({ ok: await hasCommand("git") }),
  },
  gh: {
    label: "gh (GitHub CLI) installed",
    fix: brewHint("gh"),
    run: async () => ({ ok: await hasCommand("gh") }),
  },
  ghAuth: {
    label: "gh authenticated",
    fix: "run: gh auth login",
    run: async () => ({ ok: await ghAuthed() }),
  },
};

// ── Features: each declares the tools it needs. The worker runs as long as every
// required feature's tools are present; optional features simply light up when
// theirs are. Adding a capability = one entry here. ──────────────────────────
interface Feature {
  name: string;
  required: boolean;
  summary: string;
  needs: ToolId[];
}

const FEATURES: Feature[] = [
  {
    name: "Run tickets",
    required: true,
    summary: "claim and run tickets with Claude Code",
    needs: ["claude", "apiKey"],
  },
  {
    name: "Git repos",
    required: false,
    summary: "branches, commits and diffs in git projects",
    needs: ["git"],
  },
  {
    name: "GitHub PRs & previews",
    required: false,
    summary: "open and track pull requests, resolve preview URLs",
    needs: ["gh", "ghAuth"],
  },
];

// Run all checks grouped by feature, printing each feature's status and its
// tools. Returns true when every REQUIRED feature is fully satisfied — optional
// features that are missing tools never block the worker. Shared by `markbase
// doctor` and `markbase init`/`login`.
export async function runChecks(): Promise<boolean> {
  const { appUrl, apiKey } = loadConfig();
  const env: Env = { appUrl, apiKey };

  // Evaluate each needed tool once, even when several features share it.
  const needed = new Set<ToolId>(FEATURES.flatMap((f) => f.needs));
  const results = new Map<ToolId, ToolResult>();
  await Promise.all(
    [...needed].map(async (id) => {
      results.set(id, await TOOLS[id].run(env));
    })
  );

  let allRequiredOk = true;
  for (const feature of FEATURES) {
    const enabled = feature.needs.every((id) => results.get(id)?.ok);
    if (!enabled && feature.required) allRequiredOk = false;

    const tag = feature.required ? "required" : "optional";
    const mark = enabled ? "✓" : feature.required ? "✗" : "⚠";
    console.log(`\n${mark} ${feature.name} (${tag}) — ${feature.summary}`);

    for (const id of feature.needs) {
      const result = results.get(id);
      const spec = TOOLS[id];
      const label = result?.detail ? `${spec.label} (${result.detail})` : spec.label;
      if (result?.ok) {
        console.log(`    ✓ ${label}`);
      } else {
        console.log(`    ✗ ${label}`);
        if (spec.fix) console.log(`        → ${spec.fix}`);
      }
    }
  }
  return allRequiredOk;
}

// `markbase doctor`: run the checks and print a closing hint.
export async function runDoctor(): Promise<boolean> {
  const allOk = await runChecks();
  console.log(
    allOk
      ? "\nReady. Run `markbase start` (or `markbase install-service`). Any ⚠ features above are optional — they light up once their tools are installed."
      : "\nA required feature is missing a tool — fix the ✗ items above, then re-run `markbase doctor`."
  );
  return allOk;
}
