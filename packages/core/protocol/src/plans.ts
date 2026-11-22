// Per-user plan flag, backed by public.user_plans (one row per auth user).
// Minimal today; the table is meant to grow (Stripe ids, status, period end).
export type Plan = "free" | "pro";
