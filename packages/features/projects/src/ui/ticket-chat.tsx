"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  FileText,
  Globe,
  GitCommitHorizontal,
  GitPullRequest,
  ImagePlus,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@markbase/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@markbase/ui/tabs";
import { useIsMobile } from "@markbase/ui/use-mobile";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";
import { Textarea } from "@markbase/ui/textarea";
import { Markdown } from "@markbase/ui/markdown";
import { InlineSelect } from "./inline-select";
import { AttachmentThumb } from "./attachment-thumb";
import { STATUS_STYLES } from "./status-badge";
import { Switch } from "@markbase/ui/switch";
import { uploadImages } from "@markbase/protocol/upload";
import { cn } from "@markbase/ui/utils";
import { MarkdownEditor } from "@markbase/ui/markdown-editor";
import { PropertyValueEditor } from "./ticket-properties";
import {
  TICKET_STATUSES,
  STATUS_LABELS,
  type OwnerKind,
  type ProjectProperty,
  type Ticket,
} from "@markbase/protocol/types";
import { useAgentSessions } from "@markbase/ui/use-agent-sessions";
import { AssigneePicker } from "./assignee-picker";
import { submitKeys } from "@markbase/ui/keys";

interface Msg {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

// Controlled, board-level chat sheet (rendered once, not inside each card). The
// left half is a full ticket editor; the right half continues the Claude Code
// session. `ticket` is the live ticket being chatted (null = closed).
export function TicketChat({
  ticket,
  onClose,
  onRefresh,
}: {
  ticket: Ticket | null;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const open = ticket !== null;
  const ticketId = ticket?.id ?? null;
  const project = ticket?.project ?? null;
  const ccState = ticket?.cc_state;
  const ccLastRun = ticket?.cc_last_run;

  const isMobile = useIsMobile();
  const {
    sessions: agentSessions,
    canDispatch,
    reload: reloadAgentSessions,
  } = useAgentSessions();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [chatFiles, setChatFiles] = useState<File[]>([]); // pending attachments
  const [sending, setSending] = useState(false);
  // Local mirror of the ticket's commit/PR toggle for a snappy switch; synced
  // from the prop so external updates (and reopening) reflect.
  const [autoCommit, setAutoCommit] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Follows the ticket rather than being told to by an effect, so the toggle is
  // never showing the previous ticket's setting for a frame. Keyed on both the
  // ticket and the value, so a change made elsewhere still lands.
  const autoCommitFrom = ticket ? `${ticketId}:${String(ticket.auto_commit)}` : null;
  const [autoCommitFor, setAutoCommitFor] = useState<string | null>(null);
  if (ticket && autoCommitFor !== autoCommitFrom) {
    setAutoCommitFor(autoCommitFrom);
    setAutoCommit(ticket.auto_commit);
  }

  // Text fields, auto-saved (debounced). Selects/properties save immediately.
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [requester, setRequester] = useState("");
  const [branch, setBranch] = useState("");
  const [docSaving, setDocSaving] = useState(false);
  const [saved, setSaved] = useState({
    title: "",
    description: "",
    requester: "",
    branch: "",
  });
  const [properties, setProperties] = useState<ProjectProperty[]>([]);
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  // Conversation: load on open + whenever the session state changes (Realtime).
  useEffect(() => {
    if (!ticketId) return;
    fetch(`/api/v1/tickets/${ticketId}/messages`)
      .then((r) => r.json())
      .then((d) =>
        setMessages(
          (d.messages ?? []).map((m: Msg) => ({
            role: m.role,
            content: m.content,
            images: m.images ?? [],
          }))
        )
      )
      .catch(() => setMessages([]));
  }, [ticketId, ccState, ccLastRun]);

  // Keep the thread pinned to the bottom as new messages arrive AND as the live
  // cc_summary stream grows, so streamed activity stays in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, ticket?.cc_summary]);

  // The project's property definitions (for the editable property controls).
  const [propertiesFor, setPropertiesFor] = useState<string | null | undefined>(project);
  if (propertiesFor !== project) {
    // A new project's properties are not this project's; clear them on the spot
    // rather than letting the old set show until the fetch below returns.
    setPropertiesFor(project);
    setProperties([]);
  }
  useEffect(() => {
    if (!project) return;
    fetch(`/api/admin/projects/${project}/properties`)
      .then((r) => r.json())
      .then((d) => setProperties(d.properties ?? []))
      .catch(() => setProperties([]));
  }, [project]);

  // Seed the editor when a DIFFERENT ticket opens; never on the same ticket's
  // live updates, or an edit in progress would be overwritten under the cursor.
  // Keyed on the id alone for that reason, and adjusted during render so the
  // fields never show the previous ticket's text for a frame.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (ticket && seededFor !== ticketId) {
    setSeededFor(ticketId);
    setTitle(ticket.title);
    setDesc(ticket.description);
    setRequester(ticket.requester);
    setBranch(ticket.base_branch ?? "");
    setSaved({
      title: ticket.title,
      description: ticket.description,
      requester: ticket.requester,
      branch: ticket.base_branch ?? "",
    });
  }

  // Debounced auto-save of the text fields.
  useEffect(() => {
    if (!ticketId) return;
    if (!title.trim()) return; // don't blank the title
    if (
      title === saved.title &&
      desc === saved.description &&
      requester === saved.requester &&
      branch === saved.branch
    )
      return;
    const handle = setTimeout(async () => {
      setDocSaving(true);
      try {
        const res = await fetch(`/api/v1/tickets/${ticketId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description: desc,
            requester,
            base_branch: branch.trim() || null,
          }),
        });
        if (res.ok) {
          setSaved({ title, description: desc, requester, branch });
          refreshRef.current();
        }
      } finally {
        setDocSaving(false);
      }
    }, 800);
    return () => clearTimeout(handle);
  }, [title, desc, requester, branch, ticketId, saved]);

  const dirty =
    title !== saved.title ||
    desc !== saved.description ||
    requester !== saved.requester ||
    branch !== saved.branch;

  // Immediate field patch (status / assignee), then refresh the board.
  async function patchField(body: {
    status?: string;
    ownerKind?: OwnerKind;
    agentSessionId?: string | null;
  }) {
    if (!ticketId) return;
    await fetch(`/api/v1/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
    refreshRef.current();
  }

  // Toggle commit/PR behavior for this ticket's session (optimistic + persist).
  async function toggleAutoCommit(next: boolean) {
    if (!ticketId) return;
    setAutoCommit(next);
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_commit: next }),
      });
      if (!res.ok) throw new Error();
      onRefresh();
    } catch {
      setAutoCommit(!next); // revert
      toast.error("Couldn't update the commit setting");
    }
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    setChatFiles((prev) => [...prev, ...picked].slice(0, 10));
  }

  async function send() {
    const text = input.trim();
    const files = chatFiles;
    if ((!text && files.length === 0) || sending || !ticketId) return;
    setSending(true);
    try {
      // Upload attachments first; keep the composer intact if it fails so the
      // user can retry.
      const images = files.length
        ? await uploadImages(files, project ?? "chat")
        : [];
      setInput("");
      setChatFiles([]);
      setMessages((p) => [...p, { role: "user", content: text, images }]);
      const res = await fetch(`/api/v1/tickets/${ticketId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, images }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        setMessages((p) => [
          ...p,
          { role: "assistant", content: `[error] ${err.error ?? "Failed"}` },
        ]);
        return;
      }
      onRefresh();
    } catch {
      setMessages((p) => [
        ...p,
        { role: "assistant", content: "[error] Failed to send attachments" },
      ]);
    } finally {
      setSending(false);
    }
  }

  // Re-render periodically while a run is active so the heartbeat-staleness
  // check below re-evaluates even without a Realtime push (e.g. if the worker
  // dies, no further updates arrive — we still need to stop showing "Working…").
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (ccState !== "running") return;
    const id = setInterval(() => forceTick((t) => t + 1), 20_000);
    return () => clearInterval(id);
  }, [ccState]);

  // The worker heartbeats cc_last_run every 60s while a run is alive, so a
  // heartbeat older than a few missed beats means the run is dead (crashed,
  // slept, or the worker restarted mid-run) even though cc_state is still
  // "running". Treat that as interrupted, not live — so we don't show
  // "Working…" for a run that has actually stopped.
  const HEARTBEAT_STALE_MS = 150_000; // ~2.5 min
  // "Seen in the last 2.5 minutes" is a question about now, so reading the clock
  // is the answer, not an impurity to design away. It is recomputed whenever this
  // re-renders, which is whenever the run's data changes — the only times the
  // answer can matter.
  const heartbeatFresh = ccLastRun
    ? // eslint-disable-next-line react-hooks/purity
      Date.now() - new Date(ccLastRun).getTime() < HEARTBEAT_STALE_MS
    : false;
  const interrupted = ccState === "running" && !heartbeatFresh;
  const live = ccState === "queued" || (ccState === "running" && heartbeatFresh);

  // The ticket editor — left half on desktop, the "Ticket" tab on mobile.
  const ticketPanel = ticket && (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5 md:border-r">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled ticket"
          className="w-full bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-muted-foreground"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status">
            <InlineSelect
              value={ticket.status}
              onChange={(v) => patchField({ status: v })}
              options={TICKET_STATUSES.map((s) => ({
                value: s,
                label: STATUS_LABELS[s],
              }))}
              triggerClassName={cn(
                "border-transparent font-medium",
                STATUS_STYLES[ticket.status]
              )}
            />
          </Field>
          <Field label="Assignee">
            <AssigneePicker
              ticket={ticket}
              sessions={agentSessions}
              canDispatch={canDispatch}
              onAssign={(a) => patchField(a)}
              onCreated={reloadAgentSessions}
            />
          </Field>
          <Field label="Requester">
            <Input
              value={requester}
              onChange={(e) => setRequester(e.target.value)}
              placeholder="Who requested this?"
            />
          </Field>
          <Field label="Branch">
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="auto"
            />
          </Field>
        </div>

        {properties.length > 0 && (
          <div className="space-y-1.5">
            <Label>Properties</Label>
            <div className="flex flex-wrap gap-2">
              {properties.map((p) => (
                <div key={p.id} className="w-[160px]">
                  <PropertyValueEditor
                    ticket={ticket}
                    property={p}
                    onSaved={() => refreshRef.current()}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Description</Label>
          <MarkdownEditor
            value={desc}
            onChange={setDesc}
            rows={14}
            placeholder="Describe the ticket…"
          />
        </div>

        {ticket.images?.length > 0 && (
          <div className="space-y-1.5">
            <Label>Attachments</Label>
            <div className="flex flex-wrap gap-2">
              {ticket.images.map((url, i) => (
                <AttachmentThumb key={i} url={url} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // The Claude Code follow-up chat — right half on desktop, "Chat" tab on mobile.
  const chatPanel = ticket && (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/20">
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} images={m.images} />
        ))}
        {/* A completed dispatch-only ticket (no chat thread) shows its summary
            as a bubble. While running we don't render the transcript — the live
            compact status goes in the indicator below instead. */}
        {!live && ticket.cc_summary && messages.length === 0 && (
          <Bubble role="assistant" content={ticket.cc_summary} />
        )}
        {(live || sending) && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="inline size-3 shrink-0 animate-spin" />
            <span className="truncate">
              {ccState === "queued"
                ? "Queued — waiting for the worker…"
                : ticket.cc_summary
                  ? `Working… ${ticket.cc_summary}`
                  : "Claude Code is working…"}
            </span>
          </p>
        )}
        {interrupted && !sending && (
          <p className="text-xs text-destructive">
            Run interrupted — the worker stopped responding. Click Run to retry.
          </p>
        )}
      </div>

      <div className="border-t p-3">
        {/* Pending attachments awaiting send. */}
        {chatFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {chatFiles.map((f, i) => (
              <div key={i} className="relative">
                {f.type === "application/pdf" ? (
                  <div className="flex size-14 flex-col items-center justify-center gap-1 rounded-md border bg-muted/40 p-1 text-center">
                    <FileText className="size-4 text-muted-foreground" />
                    <span className="w-full truncate text-[9px] text-muted-foreground">
                      {f.name}
                    </span>
                  </div>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="size-14 rounded-md border object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() =>
                    setChatFiles((p) => p.filter((_, idx) => idx !== i))
                  }
                  className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                  aria-label="Remove attachment"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={onPickFiles}
            className="hidden"
          />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={2}
            placeholder={
              live
                ? "Queue a follow-up… (runs after the current one)"
                : "Send a follow-up… (Enter to send, Shift+Enter for newline)"
            }
            onKeyDown={submitKeys({ onSubmit: send, multiline: true })}
          />
          {/* Attach sits above Send. */}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach images or PDFs"
              title="Attach images or PDFs"
            >
              <ImagePlus className="size-4" />
            </Button>
            <Button
              size="icon"
              onClick={send}
              disabled={sending || (!input.trim() && chatFiles.length === 0)}
              aria-label="Send"
              title="Send"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
        {live && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            A run is in progress — your message will be queued and run
            next.
          </p>
        )}
      </div>
    </div>
  );

  // Mobile splits the ticket editor and chat into tabs. The switcher lives in
  // the header itself (before the saved status) rather than on its own row
  // above the panels.
  const tabSwitcher = (
    <TabsList className="h-7 p-0.5">
      <TabsTrigger value="ticket" className="h-6 px-3 text-xs">
        Ticket
      </TabsTrigger>
      <TabsTrigger value="chat" className="h-6 px-3 text-xs">
        Chat
      </TabsTrigger>
    </TabsList>
  );

  // Shared header for both layouts; on mobile it also hosts the tab switcher.
  const header = ticket && (
    <SheetHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b px-4 py-2.5 pr-12">
      <SheetTitle className="sr-only">{ticket.title}</SheetTitle>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {isMobile && tabSwitcher}
        <span className="inline-flex items-center gap-1">
          {docSaving ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Saving…
            </>
          ) : dirty ? (
            "Unsaved…"
          ) : (
            <>
              <Check className="size-3" /> Saved
            </>
          )}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {/* Commit & PR toggle: on = commit after each change and open/update a
            PR; off = leave changes uncommitted for review. */}
        <label
          className="inline-flex cursor-pointer items-center gap-1.5"
          title={
            autoCommit
              ? "On: commit after each change and open/update a PR"
              : "Off: make changes but don't commit, push, or open a PR"
          }
        >
          <GitCommitHorizontal className="size-3.5 text-muted-foreground" />
          <span className="hidden text-muted-foreground sm:inline">
            Commit &amp; PR
          </span>
          <Switch checked={autoCommit} onCheckedChange={toggleAutoCommit} />
        </label>
        {ticket.pr_url && (
          <a
            href={ticket.pr_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <GitPullRequest className="size-3.5" /> PR #{ticket.pr_id}
          </a>
        )}
        {ticket.preview_url && (
          <a
            href={ticket.preview_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            <Globe className="size-3.5" /> Preview
          </a>
        )}
      </div>
    </SheetHeader>
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="flex flex-col gap-0 p-0 data-[side=bottom]:h-[95dvh]"
      >
        {ticket &&
          // Desktop: ticket editor and chat side by side. Mobile: too narrow for
          // both, so the header's tab switcher flips between them (Chat default).
          (isMobile ? (
            <Tabs
              defaultValue="chat"
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              {header}
              <TabsContent
                value="ticket"
                className="mt-0 flex min-h-0 flex-1 flex-col"
              >
                {ticketPanel}
              </TabsContent>
              <TabsContent
                value="chat"
                className="mt-0 flex min-h-0 flex-1 flex-col"
              >
                {chatPanel}
              </TabsContent>
            </Tabs>
          ) : (
            <>
              {header}
              <div className="flex min-h-0 flex-1">
                {ticketPanel}
                {chatPanel}
              </div>
            </>
          ))}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Bubble({
  role,
  content,
  images,
}: {
  role: string;
  content: string;
  images?: string[];
}) {
  const isUser = role === "user";
  const hasImages = (images?.length ?? 0) > 0;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "whitespace-pre-wrap bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {hasImages && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {images!.map((url, i) => (
              <AttachmentThumb key={i} url={url} className="size-16" />
            ))}
          </div>
        )}
        {content
          ? isUser
            ? content
            : <Markdown content={content} />
          : hasImages
            ? null
            : "…"}
      </div>
    </div>
  );
}
