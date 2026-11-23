"use client";

import { useEffect, useRef } from "react";
import { Bot } from "lucide-react";
import { trackEvent } from "@markbase/shared/analytics/funnel/events";
import { Button } from "@markbase/ui/button";
import { ConnectAgents } from "@markbase/ui/connect-agents";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@markbase/ui/dialog";

/**
 * "Connect an agent", offered once after an account's first vault is created.
 * The vault is the first thing an agent could work on, so this is the moment
 * the offer means something; it is skippable, and the same buttons stay on
 * the API keys page.
 *
 * It reports what happens to it — shown, an agent pressed, closed and how —
 * as product events, since none of that leaves a row of its own: a person who
 * skips it and one who copies a command and never runs it both end with no key.
 */
export function ConnectAgentDialog({
  open,
  onOpenChange,
  isDesktop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDesktop: boolean;
}) {
  const surface = isDesktop ? "desktop" : "web";

  // Once per opening. React runs an effect twice on mount in development,
  // and a count that doubles there is a count nobody can check locally.
  const reportedOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      reportedOpen.current = false;
      return;
    }
    if (reportedOpen.current) return;
    reportedOpen.current = true;
    trackEvent("connect_agent.shown", { surface });
  }, [open, surface]);

  function close(via: "not_now" | "closed") {
    trackEvent("connect_agent.dismissed", { surface, via });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close("closed"))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5" />
            Connect an agent
          </DialogTitle>
          <DialogDescription>
            Your vault is ready. Let the agent you already use read, edit and comment on its documents.
          </DialogDescription>
        </DialogHeader>
        {/* The address is this page's own: the hosted MCP server is served by
            the instance the vault was just created on. */}
        {open && (
          <ConnectAgents
            mcpUrl={`${window.location.origin}/mcp`}
            appLinks={!isDesktop}
            onAction={(agent) => trackEvent("connect_agent.clicked", { surface, agent })}
          />
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => close("not_now")}
          >
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
