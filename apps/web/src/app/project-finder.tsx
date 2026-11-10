"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";

export function ProjectFinder() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  async function go(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = value.trim();
    if (!q) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/lookup?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        toast.error(`No project named “${q}”`);
        return;
      }
      const { slug } = await res.json();
      router.push(`/projects/${slug}`);
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={go} className="mt-8 flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter your project name"
        aria-label="Project name"
        className="max-w-xs"
        autoFocus
      />
      <Button type="submit" disabled={loading || !value.trim()}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>
            Go
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>
    </form>
  );
}
