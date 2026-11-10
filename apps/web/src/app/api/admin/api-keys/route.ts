import { NextResponse } from "next/server";
import { createApiKey, listApiKeys } from "@markbase/node/api-keys";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/admin/api-keys — list key metadata (never the token or hash).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ apiKeys: await listApiKeys(user.id) });
}

// POST /api/admin/api-keys  { name, scopes? } — mint a key. The plaintext token
// is returned ONCE here and never stored; only its hash is persisted.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { name?: string; scopes?: string[]; capability?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const { apiKey, token } = await createApiKey({
    name,
    scopes: body.scopes,
    ownerId: user.id,
    ownerEmail: user.email ?? null,
    capability: body.capability ?? null,
  });
  return NextResponse.json({ apiKey, token }, { status: 201 });
}
