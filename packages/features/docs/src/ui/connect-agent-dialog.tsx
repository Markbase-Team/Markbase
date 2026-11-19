"use client";

import { Bot } from "lucide-react";
import { Button } from "@markbase/ui/button";
import { ConnectAgents } from "@markbase/ui/connect-agents";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@markbase/ui/dialog";

/**
 * "Connect an agent", offered once after an account's first vault is created.
 * The vault is the first thing an agent could work on, so this is the moment
 * the offer means something; it is skippable, and the same buttons stay on
 * the API keys page.
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
        {open && <ConnectAgents mcpUrl={`${window.location.origin}/mcp`} appLinks={!isDesktop} />}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
