"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Code, Copy, Download, ExternalLink, MessageSquare, Terminal } from "lucide-react";
import { connectOptions, type ConnectOption } from "@markbase/shared/connect-links";
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
//
// `onAction` hears which agent was pressed, before anything else happens, for
// a caller that counts it.
export function ConnectAgents({
  mcpUrl,
  appLinks = true,
  onAction,
}: {
  mcpUrl: string;
  appLinks?: boolean;
  onAction?: (agentId: string) => void;
}) {
  const [done, setDone] = useState<string | null>(null);
  // The last command or address a button copied, kept on the page: it says
  // what was copied, and it is there to copy by hand when the browser would
  // not let the page use the clipboard.
  const [shown, setShown] = useState<ConnectOption | null>(null);

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function act(option: ConnectOption) {
    onAction?.(option.id);
    setShown(option);
    if (option.kind === "link" && option.href) {
      // Followed in place, the way an app's own link has to be. Whether the
      // app opened, the page cannot tell, so nothing here says it did, and
      // the way to do it by hand is shown under the buttons every time.
      toast.message(option.after);
      window.location.href = option.href;
      return;
    }
    const copied = option.copy ? await copyText(option.copy) : true;
    if (copied) {
      setDone(option.id);
      setTimeout(() => setDone((current) => (current === option.id ? null : current)), 2000);
      toast.success(option.after);
    } else {
      toast.error("Couldn't copy it for you. It is shown under the buttons to copy by hand.");
    }
    if (option.href) window.open(option.href, "_blank", "noopener,noreferrer");
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
      {shown?.fallback && (
        <div className="mt-3 rounded-xl border bg-muted/50 p-3" aria-live="polite">
          <div className="text-xs font-medium">{shown.name}</div>
          <p className="mt-1 text-xs text-muted-foreground">{shown.fallback.where}</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-2 font-mono text-xs whitespace-pre-wrap break-all select-all">
            {shown.fallback.text}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const fallback = shown.fallback;
                if (!fallback) return;
                if (await copyText(fallback.text)) toast.success("Copied.");
                else toast.error("Couldn't copy it for you. Select it above and copy it by hand.");
              }}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 text-xs font-medium transition hover:bg-muted"
            >
              <Copy className="size-3.5" /> Copy
            </button>
            <a
              href={shown.fallback.getApp}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              <Download className="size-3.5" /> Don&apos;t have {shown.name}? Get it
            </a>
          </div>
        </div>
      )}
      {shown?.steps && (
        <div className="mt-3 rounded-xl border bg-muted/50 p-3" aria-live="polite">
          <div className="text-xs font-medium">Then, in {shown.name}</div>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            {shown.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
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
