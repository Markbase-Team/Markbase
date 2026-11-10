"use client";

import { useState } from "react";
import { useNavigation } from "@markbase/ui/navigation";
import type {} from "./routes";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";
import { InlineSelect } from "./inline-select";
import {
  ownerSelectValue,
  parseOwnerValue,
  type AgentSessionLite,
} from "@markbase/ui/use-agent-sessions";
import type { OwnerKind } from "@markbase/protocol/types";

// Sentinel option values (never a real assignee).
const NEW = "__new__";
const MORE = "__more__";
const LOCKED = "__locked__";
// How many sessions the dropdown shows before spilling into the "More…" dialog.
const RECENT = 5;
const PAGE = 10;

export type Assignment = { ownerKind: OwnerKind; agentSessionId: string | null };

// Assign a ticket to "Me" or one of the named agent sessions. The first option
// creates a brand-new session agent (named, or skip for a suggested name) which
// the worker launches in this ticket's project. Only the most recent sessions are
// listed inline; the rest are paginated in a dialog.
export function AssigneePicker({
  ticket,
  sessions,
  canDispatch = true,
  onAssign,
  onCreated,
  triggerClassName,
}: {
  ticket: {
    owner_kind: OwnerKind;
    agent_session_id: string | null;
    project: string;
    title: string;
  };
  sessions: AgentSessionLite[];
  /** False when the user has no Claude Code: only "Me" is assignable. */
  canDispatch?: boolean;
  onAssign: (a: Assignment) => void;
  onCreated?: () => void;
  triggerClassName?: string;
}) {
  const { push, refresh, routes } = useNavigation();
  const [naming, setNaming] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const current = ownerSelectValue(ticket);
  const suggested = ticket.title.trim().slice(0, 40) || "New agent";

  // Recent sessions inline; make sure the ticket's current one is always present.
  const recent = sessions.slice(0, RECENT);
  const inline = recent.some((s) => `agent:${s.id}` === current)
    ? recent
    : [...recent, ...sessions.filter((s) => `agent:${s.id}` === current)];

  // Without Claude Code nothing can run the ticket, so agents aren't offered —
  // just the user, and a way to learn how to unlock them. The ticket itself is
  // still fully usable; only this one step is gated.
  const options = canDispatch
    ? [
        { value: NEW, label: "New session agent…" },
        { value: "user", label: "Me" },
        ...inline.map((s) => ({ value: `agent:${s.id}`, label: s.name })),
        ...(sessions.length > inline.length
          ? [{ value: MORE, label: "More sessions…" }]
          : []),
      ]
    : [
        { value: "user", label: "Me" },
        { value: LOCKED, label: "Agents need Claude Code…" },
      ];
  if (!options.some((o) => o.value === current)) {
    options.push({ value: current, label: "Agent" });
  }

  function onChange(v: string) {
    if (v === LOCKED) {
      push(routes.quickstart("ticketDispatch"));
      return;
    }
    if (v === NEW) {
      setName("");
      setNaming(true);
      return;
    }
    if (v === MORE) {
      setShown(PAGE);
      setBrowsing(true);
      return;
    }
    onAssign(parseOwnerValue(v));
  }

  // Create a session agent for this ticket's project and assign it. The worker
  // launches it (Claude Code) and binds it; a blank name uses the suggestion.
  async function createAgent(useName: string) {
    if (creating) return;
    setCreating(true);
    try {
      const r = await fetch("/api/v1/agent-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "claude_code",
          name: useName.trim() || suggested,
          project: ticket.project,
        }),
      });
      const d: { session?: { id: string }; error?: string } = await r.json();
      if (!r.ok || !d.session) throw new Error(d.error ?? "Failed");
      onAssign({ ownerKind: "agent", agentSessionId: d.session.id });
      onCreated?.();
      setNaming(false);
      toast.success("Agent created and assigned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create agent");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <InlineSelect
        value={current}
        onChange={onChange}
        options={options}
        ariaLabel="Assignee"
        triggerClassName={triggerClassName}
      />

      {/* Name the new agent (or skip for the suggested name). */}
      <Dialog open={naming} onOpenChange={(o) => !o && setNaming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New session agent</DialogTitle>
            <DialogDescription>
              Your worker launches it in {ticket.project}.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createAgent(name);
            }}
            className="space-y-3"
          >
            <div className="space-y-2">
              <Label htmlFor="new-agent-name">Name</Label>
              <Input
                id="new-agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={suggested}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => void createAgent("")}
              >
                Skip
              </Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="size-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* All sessions, paginated. */}
      <Dialog open={browsing} onOpenChange={(o) => !o && setBrowsing(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign a session agent</DialogTitle>
            <DialogDescription>
              {sessions.length} session{sessions.length === 1 ? "" : "s"}, newest first.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y rounded-lg border">
            {sessions.slice(0, shown).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onAssign({ ownerKind: "agent", agentSessionId: s.id });
                  setBrowsing(false);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground capitalize">
                  {s.status}
                </span>
              </button>
            ))}
          </div>
          {shown < sessions.length && (
            <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
              Load {Math.min(PAGE, sessions.length - shown)} more
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
