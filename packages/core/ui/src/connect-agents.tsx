"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Code, Copy, ExternalLink, MessageSquare, Terminal } from "lucide-react";
import { connectOptions, type ConnectOption } from "@markbase/protocol/connect-links";
import { AgentLogo, hasAgentLogo } from "./agent-logo";

const ICONS = { "Custom connector": MessageSquare, CLI: Terminal, IDE: Code } as const;

function iconFor(option: ConnectOption) {
  return ICONS[option.caption as keyof typeof ICONS] ?? Code;
}

// A button per agent that adds the hosted MCP server to it: the agent's own
// install link where it has one, otherwise the command or the address, copied.
// `mcpUrl` is this instance's /mcp address. Used in the docs, the dashboard's
// API keys page and after a first vault is created.
//
// `appLinks={false}` leaves out the agents that are added by a link their own
// app opens (`cursor://…`). The desktop app's window only lets web addresses
// out, so there those buttons would do nothing.
export function ConnectAgents({ mcpUrl, appLinks = true }: { mcpUrl: string; appLinks?: boolean }) {
  const [done, setDone] = useState<string | null>(null);
  // The last command or address a button copied, kept on the page: it says
  // what was copied, and it is there to copy by hand when the browser would
  // not let the page use the clipboard.
  const [shown, setShown] = useState<ConnectOption | null>(null);

  async function act(option: ConnectOption) {
    let copied = true;
    if (option.copy) {
      setShown(option);
      try {
        await navigator.clipboard.writeText(option.copy);
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setDone(option.id);
      setTimeout(() => setDone((current) => (current === option.id ? null : current)), 2000);
      toast.success(option.after);
    } else {
      toast.error("Couldn't copy it for you. It is shown under the buttons to copy by hand.");
    }
    if (option.href) {
      // An app's own link is followed in place; a web page opens beside this one.
      if (option.kind === "link") window.location.href = option.href;
      else window.open(option.href, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="not-prose">
      <ul className="grid gap-3 sm:grid-cols-2">
        {connectOptions(mcpUrl)
          .filter((option) => appLinks || option.kind !== "link")
          .map((option) => {
          const Icon = iconFor(option);
          const Action = done === option.id ? Check : option.kind === "command" ? Copy : ExternalLink;
          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => act(option)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left text-card-foreground transition hover:border-foreground/50 active:scale-[0.99]"
              >
                {hasAgentLogo(option.id) ? (
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-background">
                    <AgentLogo agent={option.id} className={option.id === "codex" ? "size-8" : "size-5"} />
                  </span>
                ) : (
                  // No mark for this one: an icon for the kind of app it is.
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#e5ff6e] text-zinc-900">
                    <Icon className="size-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{option.name}</span>
                  <span className="block text-xs text-muted-foreground">{option.caption}</span>
                </span>
                <Action className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
      {shown?.copy && (
        <div className="mt-3 rounded-xl border bg-muted/50 p-3" aria-live="polite">
          <div className="text-xs font-medium">{shown.name}</div>
          <code className="mt-1 block font-mono text-xs break-all select-all">{shown.copy}</code>
          <p className="mt-1.5 text-xs text-muted-foreground">{shown.after.replace(/^(Command|Address) copied\. /, "")}</p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Each one ends with a sign-in in your browser, where you choose what the agent may do. Any other agent: add{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] break-all">{mcpUrl}</code> as a remote
        MCP server.
      </p>
    </div>
  );
}
