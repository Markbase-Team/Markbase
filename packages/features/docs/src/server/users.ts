import { supabase } from "@markbase/protocol/supabase";

// Resolve a user's display identity (for "so-and-so invited you" copy). Uses the
// admin API, so it needs the service key — which the server client carries.
export async function getUserDisplay(
  userId: string
): Promise<{ email: string | null; name: string | null }> {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const u = data?.user;
    const meta = (u?.user_metadata ?? {}) as {
      full_name?: string;
      name?: string;
    };
    return {
      email: u?.email ?? null,
      name: meta.full_name ?? meta.name ?? null,
    };
  } catch {
    return { email: null, name: null };
  }
}
