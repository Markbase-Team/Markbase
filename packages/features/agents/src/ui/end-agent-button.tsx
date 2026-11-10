"use client";

import { useState } from "react";
import { useNavigation } from "@markbase/ui/navigation";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";

// End a live agent session (kept as history, can't be continued). Only rendered
// for sessions that are still endable (active / idle / pending).
export function EndAgentButton({ id }: { id: string }) {
  const nav = useNavigation();
  const [busy, setBusy] = useState(false);

  async function end() {
    if (!confirm("End this agent session? It stays as history but can't be continued.")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/agent-sessions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "ended" }),
      });
      if (!r.ok) throw new Error();
      nav.refresh();
    } catch {
      toast.error("Couldn't end session");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={end}
      disabled={busy}
      title="End session"
      aria-label="End session"
      className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
    </button>
  );
}
