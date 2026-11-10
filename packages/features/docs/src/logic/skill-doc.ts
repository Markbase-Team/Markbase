import { AGENT_ENDPOINTS, type DocEndpoint } from "./endpoints";

// Render the endpoint registry into the markdown block the agent skill embeds.
// This is what keeps skills/markbase/SKILL.md exactly in step with the real
// endpoints and their roles — regenerate the skill and any endpoint change (path,
// role, input/output, when-to-use) flows straight in.

const BASE = "$BASE";

function methodPath(e: DocEndpoint): string {
  return `${e.method.padEnd(6)} ${BASE}${e.path}`;
}

function roleLabel(e: DocEndpoint): string {
  return e.capability ?? "signed-in";
}

export function renderEndpointsDoc(): string {
  const lines: string[] = [];

  // 1. The table of every endpoint, its role, and what it does.
  lines.push("## Endpoints");
  lines.push("");
  lines.push(
    "Each endpoint lists the **minimum role** it needs. Roles are ranked " +
      "`owner > editor > commenter > viewer`, so any role at or above the one " +
      "shown is allowed (an owner can do everything an editor can). " +
      "`signed-in` = any authenticated caller with the right scope."
  );
  lines.push("");
  lines.push("| Method & path | Role | Purpose |");
  lines.push("| --- | --- | --- |");
  for (const e of AGENT_ENDPOINTS) {
    lines.push(`| \`${methodPath(e)}\` | ${roleLabel(e)} | ${e.summary} |`);
  }
  lines.push("");

  // 2. How to use each documented endpoint (when / input / output / example).
  lines.push("## How to use");
  for (const e of AGENT_ENDPOINTS) {
    if (!e.skill) continue;
    lines.push("");
    lines.push(`### ${e.summary}`);
    lines.push(
      `\`${e.method} ${e.path}\` · role: **${roleLabel(e)}** · scope: ${e.scope}`
    );
    lines.push("");
    lines.push(`- **When:** ${e.skill.whenToUse}`);
    if (e.skill.input) lines.push(`- **Input:** \`${e.skill.input}\``);
    lines.push(`- **Output:** ${e.skill.output}`);
    if (e.skill.example) {
      lines.push("");
      lines.push("```bash");
      lines.push(e.skill.example);
      lines.push("```");
    }
  }

  return lines.join("\n");
}
