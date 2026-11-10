import { AGENT_ENDPOINTS, docEndpoint, type DocEndpoint } from "@markbase/docs/endpoints";
import { callEndpoint, pathParams } from "./call";

// `markbase api <endpoint> [key=value] [key:=json]` — call any document endpoint
// straight from the registry, the way `slack api <method>` fronts the Slack Web
// API. `key=value` sends a string; `key:=json` sends raw JSON.
//
//   markbase api readDoc id=<docId>
//   markbase api editDoc id=<docId> quote="old" insert="**new**"
//   markbase api reorderTabs id=<docId> order:='["id1","id2"]'

function line(e: DocEndpoint): string {
  const role = e.capability ?? "signed-in";
  return `  ${e.id.padEnd(16)} ${e.method.padEnd(6)} ${e.path.padEnd(26)} ${role}`;
}

function printList(): void {
  console.log("Call a document endpoint:  markbase api <endpoint> [key=value] [key:=json]\n");
  console.log("  endpoint         method path                       role");
  console.log("  " + "-".repeat(62));
  for (const e of AGENT_ENDPOINTS) console.log(line(e));
  console.log("\nRun `markbase api <endpoint> --help` for its inputs/outputs.");
}

function printEndpoint(e: DocEndpoint): void {
  console.log(`${e.method} ${e.path}`);
  console.log(`  role:   ${e.capability ?? "signed-in"} · scope: ${e.scope}`);
  console.log(`  ${e.summary}`);
  const pp = pathParams(e.path);
  if (pp.length) console.log(`  path:   ${pp.map((p) => `${p}=…`).join(" ")}`);
  for (const p of e.params ?? []) {
    console.log(`  ${p.name}${p.required ? "*" : ""}: ${p.type}  ${p.description ?? ""}`);
  }
  if (e.skill) {
    console.log(`  when:   ${e.skill.whenToUse}`);
    console.log(`  output: ${e.skill.output}`);
  }
}

export async function runApi(argv: string[]): Promise<void> {
  const [endpointId, ...rest] = argv;
  if (!endpointId || endpointId === "list" || endpointId === "--list" || endpointId === "-l") {
    printList();
    return;
  }

  let ep: DocEndpoint | undefined;
  try {
    ep = docEndpoint(endpointId);
  } catch {
    ep = undefined;
  }
  // Unknown, or editor-only plumbing — agents shouldn't see or call these.
  if (!ep || ep.humanOnly) {
    console.error(`Unknown endpoint: ${endpointId}\n`);
    printList();
    process.exitCode = 1;
    return;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    printEndpoint(ep);
    return;
  }

  // Parse key=value (string) and key:=json (raw JSON) args.
  const params: Record<string, unknown> = {};
  for (const arg of rest) {
    const json = /^([^=]+):=(.*)$/s.exec(arg);
    const str = /^([^=]+)=(.*)$/s.exec(arg);
    if (json) {
      try {
        params[json[1]] = JSON.parse(json[2]);
      } catch {
        console.error(`Invalid JSON for ${json[1]}: ${json[2]}`);
        process.exitCode = 1;
        return;
      }
    } else if (str) {
      params[str[1]] = str[2];
    } else {
      console.error(`Bad argument (expected key=value): ${arg}`);
      process.exitCode = 1;
      return;
    }
  }

  try {
    const r = await callEndpoint(ep, params);
    let pretty = r.body;
    try {
      pretty = JSON.stringify(JSON.parse(r.body), null, 2);
    } catch {
      // not JSON
    }
    if (!r.ok) {
      console.error(`HTTP ${r.status}`);
      process.exitCode = 1;
    }
    console.log(pretty);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
