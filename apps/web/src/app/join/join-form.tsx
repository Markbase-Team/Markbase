"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@markbase/protocol/api-client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Input } from "@markbase/ui/input";

// Create an account on this instance with its invite code: the server checks
// the code and creates the user (POST /api/v1/instance/join), then the browser
// signs in with the same password. No confirmation mail — the code vouched.
export function JoinForm({
  code,
  next,
  label = "Create your account",
}: {
  code: string;
  next: string;
  /** The button's text — "Create your admin account" on an empty instance's set-up page. */
  label?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "");
    const password = String(fd.get("password") ?? "");
    setError(null);
    setLoading(true);
    const created = await api
      .json<{ ok: true }>("/api/v1/instance/join", {
        method: "POST",
        body: JSON.stringify({ code, email, password }),
      })
      .then(
        () => null,
        (e: Error) => e.message
      );
    if (created) {
      setLoading(false);
      setError(created);
      return;
    }
    const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Input
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="h-12 rounded-lg px-4 text-sm"
      />
      <Input
        name="password"
        type="password"
        required
        autoComplete="new-password"
        placeholder="Choose a password"
        className="h-12 rounded-lg px-4 text-sm"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="flex h-12 w-full items-center justify-center rounded-lg bg-[#e5ff6e] px-4 text-sm font-semibold text-zinc-900 transition hover:brightness-95 active:scale-[0.98] disabled:opacity-60"
      >
        {loading ? `${label.replace(/^Create/, "Creating")}…` : label}
      </button>
    </form>
  );
}
