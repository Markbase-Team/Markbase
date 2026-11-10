"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, MailX } from "lucide-react";
import { Button } from "@markbase/ui/button";
import type { UnsubscribeInfo } from "../server/unsubscribe";

// The unsubscribe agent's reply (mirrors @markbase/browser-agent's
// UnsubscribeResult — kept inline so this client component pulls no server deps).
type UnsubscribeResult = {
  ok: boolean;
  method: "one-click" | "browser" | "mailto" | "none";
  message: string;
  finalUrl?: string;
  steps?: string[];
  manualUrl?: string;
  mailto?: string;
};

type Status = "idle" | "running" | "done";

type ButtonVariant = "outline" | "ghost" | "default" | "secondary";
type ButtonSize = "sm" | "default" | "xs";

// True when there's any unsubscribe target to act on. Mirrors the server's
// hasUnsubscribeTarget so the button can hide itself with no extra call.
function actionable(info: UnsubscribeInfo | null | undefined): boolean {
  return !!(info && (info.httpUrl || info.bodyUrl || info.mailto));
}

// Unsubscribe action. Posts to the agent endpoint, which unsubscribes via a
// one-click POST when possible, otherwise drives a headless browser through the
// confirmation page. Hides itself when the email exposes no unsubscribe target.
export function UnsubscribeButton({
  accountId,
  messageId,
  info,
  variant = "outline",
  size = "sm",
}: {
  accountId: string;
  messageId: string;
  info: UnsubscribeInfo | null | undefined;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [status, setStatus] = useState<Status>("idle");

  if (!actionable(info)) return null;

  async function run() {
    setStatus("running");
    const toastId = toast.loading("Unsubscribing — spinning up a browser agent…");
    try {
      const res = await fetch("/api/v1/inbox/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: accountId, id: messageId }),
      });
      const data: { result?: UnsubscribeResult; error?: string } =
        await res.json();
      if (!res.ok || !data.result) {
        toast.error(data.error ?? "Couldn't unsubscribe", { id: toastId });
        setStatus("idle");
        return;
      }
      const result = data.result;
      if (result.ok) {
        toast.success(result.message, { id: toastId });
        setStatus("done");
        return;
      }
      // Couldn't confirm automatically — offer a way to finish by hand.
      setStatus("idle");
      const action = result.manualUrl
        ? {
            label: "Open page",
            onClick: () => window.open(result.manualUrl, "_blank", "noopener"),
          }
        : result.mailto
          ? {
              label: "Email",
              onClick: () => {
                window.location.href = `mailto:${result.mailto}?subject=unsubscribe`;
              },
            }
          : undefined;
      toast.message(result.message, {
        id: toastId,
        description: result.steps?.length ? result.steps.join(" → ") : undefined,
        action,
      });
    } catch {
      toast.error("Couldn't unsubscribe", { id: toastId });
      setStatus("idle");
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={run}
      disabled={status !== "idle"}
      title="Unsubscribe — a browser agent does it for you"
    >
      {status === "running" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : status === "done" ? (
        <Check className="size-3.5" />
      ) : (
        <MailX className="size-3.5" />
      )}
      {status === "done" ? "Unsubscribed" : "Unsubscribe"}
    </Button>
  );
}
