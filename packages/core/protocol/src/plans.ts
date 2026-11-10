import { supabase } from "./supabase";

// Per-user plan flag, backed by public.user_plans (one row per auth user).
// Minimal today; the table is meant to grow (Stripe ids, status, period end).
export type Plan = "free" | "pro";

// The user's plan, defaulting to 'free' when they have no row yet.
export async function getUserPlan(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("user_plans")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { plan?: string } | null;
  return row?.plan ?? "free";
}

// True for paid users. Gates the live-streaming worker narration.
export async function isPaidUser(userId: string): Promise<boolean> {
  return (await getUserPlan(userId)) === "pro";
}
