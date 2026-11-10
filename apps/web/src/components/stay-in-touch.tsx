"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";

type Status = "idle" | "loading" | "done" | "error";

// Landing "Stay in touch" email capture. Posts to /api/subscribe, which stores
// the address (idempotent). Styled for the light landing sections.
export function StayInTouchForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError("");
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), source: "landing" }),
      });
      const d: { error?: string } = await r.json();
      if (!r.ok) {
        setStatus("error");
        setError(d.error ?? "Something went wrong");
        return;
      }
      setStatus("done");
      setEmail("");
    } catch {
      setStatus("error");
      setError("Network error — try again");
    }
  }

  if (status === "done") {
    return (
      <p className="inline-flex items-center gap-2 text-sm font-medium text-zinc-900">
        <Check className="size-4 text-[#3a9e00]" />
        You&apos;re on the list — we&apos;ll be in touch.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          aria-label="Email address"
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#e5ff6e] px-5 py-2.5 text-sm font-semibold text-zinc-900 transition hover:brightness-95 disabled:opacity-60"
        >
          {status === "loading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Notify me <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </div>
      {status === "error" && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </form>
  );
}
