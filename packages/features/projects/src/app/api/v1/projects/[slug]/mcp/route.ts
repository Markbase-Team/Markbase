import { callerFromHeaders } from "@markbase/protocol/auth";
import { getProject } from "@markbase/protocol/tickets";
import { revealProjectSecrets } from "../../../../../../server";

// GET /api/v1/projects/:slug/mcp — the worker fetches a project's MCP setup at
// run time: the config (with ${SECRET} references) plus the resolved env for
// just the secrets it references. Authenticated by the worker's API key and
// scoped to that key's owner; the secret values are decrypted server-side
// (service-role) and returned only to the verified owner's worker.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  const { slug } = await params;
  const project = await getProject(slug, caller.ownerId);
  if (!project) return Response.json({ error: "Unknown project" }, { status: 404 });

  const config = project.mcp_config;
  if (!config?.mcpServers || Object.keys(config.mcpServers).length === 0) {
    return Response.json({ mcpConfig: null, env: {} });
  }

  // Resolve only the secrets the config actually references (least privilege).
  const names = new Set<string>();
  for (const m of JSON.stringify(config).matchAll(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
  )) {
    names.add(m[1]);
  }
  const env = await revealProjectSecrets(slug, caller.ownerId, [...names]);

  return Response.json({ mcpConfig: config, env });
}
