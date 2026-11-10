import { createSecret, isSecretsConfigured, listSecrets } from "../../../../server";
import { getProject } from "@markbase/protocol/tickets";
import { callerFromHeaders } from "@markbase/protocol/auth";

// GET /api/admin/secrets?project=slug — list secret *metadata* (never values).
export async function GET(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const project = new URL(req.url).searchParams.get("project");
  if (!project) {
    return Response.json({ error: "Project is required" }, { status: 400 });
  }
  const secrets = await listSecrets(project, caller.ownerId);
  return Response.json({ secrets, configured: isSecretsConfigured() });
}

// POST /api/admin/secrets — store a new encrypted secret.
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  if (!isSecretsConfigured()) {
    return Response.json(
      { error: "SECRETS_ENCRYPTION_KEY is not configured on the server" },
      { status: 503 }
    );
  }

  let body: {
    project?: string;
    name?: string;
    description?: string;
    value?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const project = typeof body.project === "string" ? body.project : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const value = typeof body.value === "string" ? body.value : "";
  if (!project || !(await getProject(project, caller.ownerId))) {
    return Response.json({ error: "Unknown project" }, { status: 400 });
  }
  if (!name) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }
  if (!value) {
    return Response.json({ error: "Value is required" }, { status: 400 });
  }

  try {
    const secret = await createSecret({
      project,
      name,
      description:
        typeof body.description === "string" ? body.description.trim() : "",
      value,
      ownerId: caller.ownerId,
    });
    return Response.json({ secret }, { status: 201 });
  } catch (err) {
    // Unique-violation → friendly 409; otherwise generic 500 (no value leaked).
    const message = err instanceof Error ? err.message : "Failed to save secret";
    const conflict = /duplicate key|unique/i.test(message);
    return Response.json(
      { error: conflict ? "A secret with that name already exists" : message },
      { status: conflict ? 409 : 500 }
    );
  }
}
