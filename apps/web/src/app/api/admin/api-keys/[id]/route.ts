import { NextResponse } from "next/server";
import { deleteApiKey } from "@markbase/node/api-keys";
import { getCurrentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// DELETE /api/admin/api-keys/:id — revoke a key (deletes the row; the key stops
// working immediately).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await deleteApiKey(id, user.id);
  return NextResponse.json({ ok: true });
}
