"use client";

import {
  useId,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TriangleAlert,
  ArrowUp,
  ChevronRight,
  CircleDot,
  Clock3,
  CornerDownRight,
  History,
  Loader2,
  SquarePen,
  Square,
  TextSelect,
  X,
} from "lucide-react";
import { Markdown } from "@markbase/ui/markdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import type { ChatSessionMeta, StreamChunk, UsageInfo } from "@markbase/agent";
import type { AgentId } from "./agent-launcher";
import { cn } from "@markbase/ui/utils";
import { useLatest } from "@markbase/ui/latest-ref";
import { agentTheme, type AgentTheme } from "./agent-chat-theme";
// The deep path, not the package root: the root re-exports the session runtime,
// which imports the Agent SDK, which imports async_hooks — none of which can
// exist in a browser bundle. This module imports nothing at all.
import { explainFailure } from "@markbase/agent/core/explain";
import { submitKeys } from "@markbase/ui/keys";
import {
  clearCurrentSession,
  getCurrentSession,
  invalidateTranscript,
  loadTranscript,
  setCurrentSession,
  subscribeCurrentSession,
} from "./agent-session-store";
import { useIsDesktop } from "@markbase/ui/use-is-desktop";
import { useStickToBottom } from "./stick-to-bottom";
import { useDocsPorts } from "./ports";

// The native agent chat, docked on the right of the workspace. On desktop it
// drives the agent through the host's AgentPort (see ports.tsx) — the Agent SDK
// running in the vault's local folder — the same conversation a human would
// have in the CLI, but rendered to match that agent's own product (see
// agent-chat-theme). Chunks arrive on a stream keyed by a per-dock session id;
// each turn resumes the prior provider session (captured from `usage`).

type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; result?: string; isError?: boolean }
  | { kind: "error"; text: string }
  | { kind: "notice"; text: string; level?: "info" | "warning" };

type Turn = { id: string; role: "user" | "assistant"; blocks: Block[] };

let turnSeq = 0;
const nextTurnId = () => `t${++turnSeq}`;

const iconBtnCls =
  "grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

/** A one-line preview of the selected text for the composer chip. */
function selectionLabel(quote: string): string {
  const oneLine = quote.replace(/\s+/g, " ").trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}

/** Frame the highlighted text as context for the agent, as a markdown blockquote
 *  (robust against code fences in the selection) tagged with the file it's from. */
function selectionContext(quote: string, docPath?: string): string {
  const where = docPath ? ` from \`${docPath}\`` : "";
  const block = quote
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `The user highlighted this text${where}:\n\n${block}`;
}

/** A compact timestamp for the history list (client-only, so localized is fine). */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Fold one stream chunk into the last (assistant) turn. Pure — returns new turns. */
function applyChunk(turns: Turn[], chunk: StreamChunk): Turn[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== "assistant") return turns;
  const head = turns.slice(0, -1);
  const blocks = last.blocks;

  const withBlocks = (next: Block[]): Turn[] => [...head, { ...last, blocks: next }];
  const appendTo = (kind: "text" | "thinking", text: string): Turn[] => {
    const tail = blocks[blocks.length - 1];
    if (tail && tail.kind === kind) {
      return withBlocks([...blocks.slice(0, -1), { ...tail, text: tail.text + text }]);
    }
    return withBlocks([...blocks, { kind, text }]);
  };
  const setToolResult = (id: string, content: string, isError?: boolean): Turn[] =>
    withBlocks(
      blocks.map((b) =>
        b.kind === "tool" && b.id === id
          ? { ...b, result: (b.result ?? "") + content, isError: isError ?? b.isError }
          : b
      )
    );

  switch (chunk.type) {
    case "text":
      return appendTo("text", chunk.content);
    case "thinking":
      return appendTo("thinking", chunk.content);
    case "tool_use":
    case "subagent_tool_use": {
      // Streamed tool_use repeats with the same id as its input builds up — upsert
      // by id (update the input in place) rather than pushing a duplicate block.
      const existing = blocks.some((b) => b.kind === "tool" && b.id === chunk.id);
      if (existing) {
        return withBlocks(
          blocks.map((b) =>
            b.kind === "tool" && b.id === chunk.id ? { ...b, name: chunk.name, input: chunk.input } : b
          )
        );
      }
      return withBlocks([
        ...blocks,
        { kind: "tool", id: chunk.id, name: chunk.name, input: chunk.input },
      ]);
    }
    case "tool_result":
    case "subagent_tool_result":
      return setToolResult(chunk.id, chunk.content, chunk.isError);
    case "tool_output":
      return setToolResult(chunk.id, chunk.content);
    case "error":
      return withBlocks([...blocks, { kind: "error", text: chunk.content }]);
    case "notice":
      return withBlocks([...blocks, { kind: "notice", text: chunk.content, level: chunk.level }]);
    case "context_compacted":
      return withBlocks([...blocks, { kind: "notice", text: "Context compacted.", level: "info" }]);
    default:
      return turns;
  }
}

export function AgentChatDock({
  vaultId,
  docId,
  docPath,
  agentId,
  agentName,
  selection,
  onOpenFile,
  embedded = false,
}: {
  vaultId: string;
  docId?: string;
  docPath?: string;
  agentId: AgentId;
  agentName: string;
  /** The live text selection in the document editor, if any. When present it's
   *  offered as a removable chip in the composer and attached to the next message
   *  (Claudian-style), so the agent sees exactly what the user highlighted. */
  selection?: { quote: string } | null;
  /** Jump to a file the agent references (a tool's file_path, or a doc path in its
   *  prose) — resolves against the vault and opens it as a tab. */
  onOpenFile?: (path: string, opts?: { newTab: boolean }) => void;
  /** Rendered inside the doc panel (one right section) rather than as its own
   *  bordered column — drop the left border the panel already provides. */
  embedded?: boolean;
}) {
  const theme = agentTheme(agentId);
  const isDesktop = useIsDesktop();
  const [turns, setTurns] = useState<Turn[]>([]);
  // Follow the bottom while the transcript grows, and leave a reader who has
  // scrolled up alone. See the hook for why watching the height matters.
  const { viewportRef: scrollRef, contentRef, stick } = useStickToBottom();
  const [input, setInput] = useState("");
  // The editor selection is offered as a composer chip until the user removes it
  // or sends with it attached; `dismissedQuote` remembers which selection was
  // dropped so a NEW selection reappears while the dismissed one stays hidden.
  const [dismissedQuote, setDismissedQuote] = useState<string | null>(null);
  const activeSelection =
    selection && selection.quote.trim() && selection.quote !== dismissedQuote ? selection : null;
  const [running, setRunning] = useState(false);
  // Messages typed while a run was in flight, sent in order as it frees up.
  const [queue, setQueue] = useState<string[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  // The spinner word for the in-flight turn (picked per send, like the CLI).
  const [workingWord, setWorkingWord] = useState(theme.workingWords[0]);

  /**
   * Grow the composer with what you type, up to a limit, then scroll.
   *
   * It was `rows={1}` with no growth at all, so a long message stayed one line
   * tall and everything above the caret scrolled out of sight — you could not
   * read the sentence you were in the middle of writing. `max-h-40` was already
   * there as a ceiling and had simply never been reached.
   *
   * Height is reset to `auto` before reading scrollHeight: without that, the box
   * can only ever get taller, because scrollHeight is measured against the height
   * we last set.
   */
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // One IPC channel id for this dock's lifetime; the provider session id is
  // captured from `usage` chunks and passed as `resume` so each turn continues.
  // useId, not a clock and a random number: React already guarantees one id per
  // component instance, and generating it during render made the render impure —
  // two things that produce a different answer every time they are called.
  // Colons are stripped because the channel name is itself colon-delimited.
  const sessionId = `chat-${useId().replace(/:/g, "")}`;
  const providerSessionRef = useRef<string | null>(null);
  // `running` as a ref: the adopt effect awaits an IPC call and must read the
  // value as it is when the reply lands, not as it was when the effect ran.
  const runningRef = useRef(false);
  // Null in a browser: the panel then says the chat needs the desktop app.
  const { agent } = useDocsPorts();
  // Read when a turn ENDS, not when the subscription below was made. The panel
  // follows you between documents (the workspace hosts one for all of them), so
  // the document changes under a live conversation — and it must not be a
  // dependency of that subscription, whose cleanup closes the Claude process.
  const docIdRef = useLatest(docId);

  // Persistence (the `.chat/` index). A stable record id (ours, set on the first
  // captured provider session id) is kept separate from providerSessionRef (the
  // Claude resume handle). These are refs so the end-of-turn handler sees the
  // latest without re-subscribing. `sessions` backs the history menu.
  const recordIdRef = useRef<string | null>(null);
  const createdAtRef = useRef<string | null>(null);
  const firstPromptRef = useRef<string>("");
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);

  // Persistent subscription for this dock: chunks fold into the running turn, the
  // end event clears the running flag (and surfaces a fatal error if the run died).
  useEffect(() => {
    if (!agent) return;
    const offChunk = agent.chat.onChunk(sessionId, (chunk) => {
      if (chunk.type === "usage") {
        setUsage(chunk.usage);
        if (chunk.sessionId) {
          providerSessionRef.current = chunk.sessionId;
          // First provider id becomes our stable record id (Claudian-style split).
          if (!recordIdRef.current) recordIdRef.current = chunk.sessionId;
        }
        return;
      }
      setTurns((prev) => applyChunk(prev, chunk));
    });
    const offEnd = agent.chat.onEnd(sessionId, (result) => {
      runningRef.current = false;
      setRunning(false);
      if (!result.ok) {
        setFatal(result.error ?? "The agent run failed.");
        return;
      }
      // Persist the session index (metadata only — the SDK owns the transcript).
      const id = recordIdRef.current;
      const provider = providerSessionRef.current;
      if (id && provider) {
        const now = new Date().toISOString();
        const createdAt = createdAtRef.current ?? now;
        // The conversation just grew, so a cached copy of its transcript is short
        // by a turn — and this is the conversation other docks will adopt.
        invalidateTranscript(vaultId, provider);
        setCurrentSession(vaultId, {
          recordId: id,
          providerSessionId: provider,
          createdAt,
          firstPrompt: firstPromptRef.current,
        });
        // ADD this doc rather than replace: one conversation can span documents,
        // which is the whole point of it travelling with you. Writing
        // `[docId]` each time meant the link only ever remembered the last one.
        void (async () => {
          const held = await agent.sessions.get(vaultId, id).catch(() => null);
          const docIds = new Set(held?.docIds ?? []);
          const onDoc = docIdRef.current;
          if (onDoc) docIds.add(onDoc);
          await agent.sessions.save(vaultId, {
            id,
            sessionId: provider,
            vaultId,
            docIds: [...docIds],
            title: firstPromptRef.current.slice(0, 80) || "Untitled chat",
            createdAt,
            updatedAt: now,
            preview: firstPromptRef.current.slice(0, 140),
          });
        })();
      }
    });
    return () => {
      offChunk();
      offEnd();
      // The panel is going away, and its CLI is a process holding this
      // conversation open. Nothing else will notice it is unwanted.
      agent.chat.close(sessionId);
    };
    // Not `docId`: moving to another document is not the panel going away.
  }, [agent, sessionId, vaultId, docIdRef]);

  /**
   * Follow the vault's current conversation.
   *
   * Runs on mount and whenever the current session changes, so opening another
   * document, or coming back to the Claude tab, continues what you were saying
   * instead of starting again. Skipped while this dock is mid-run — nothing may
   * replace a conversation that is still streaming into it.
   */
  useEffect(() => {
    if (!agent) return;
    let dropped = false;
    const adopt = async (): Promise<void> => {
      const held = getCurrentSession(vaultId);
      if (!held) return;
      // Already showing it. Turn-by-turn growth arrives over the chunk stream;
      // reloading here would fight it.
      if (held.providerSessionId === providerSessionRef.current) return;
      if (runningRef.current) return;
      const past = await loadTranscript(vaultId, held.providerSessionId, (v, id) =>
        agent.sessions.transcript(v, id)
      );
      if (dropped || runningRef.current) return;
      // Re-check: the user may have started something else while we fetched.
      if (getCurrentSession(vaultId)?.providerSessionId !== held.providerSessionId) return;
      providerSessionRef.current = held.providerSessionId;
      recordIdRef.current = held.recordId;
      createdAtRef.current = held.createdAt;
      firstPromptRef.current = held.firstPrompt;
      stick();
      setTurns(past ?? []);
    };
    void adopt();
    const off = subscribeCurrentSession(() => void adopt());
    return () => {
      dropped = true;
      off();
    };
  }, [agent, vaultId, stick]);


  /**
   * Start a run for `message`. Split out from the composer so a QUEUED message
   * can be sent later without going back through the input box.
   */
  const sendMessage = useCallback(async (message: string) => {
    if (!message || !agent) return;
    setFatal(null);
    // Attach the highlighted text (if any) as context for the agent, and consume
    // it so its chip clears. The transcript bubble shows just the typed message.
    const sel = activeSelection;
    const prompt = sel ? `${selectionContext(sel.quote, docPath)}\n\n${message}` : message;
    if (sel) setDismissedQuote(sel.quote);
    // The first message seeds the record's title/preview/created time.
    if (!createdAtRef.current) {
      createdAtRef.current = new Date().toISOString();
      firstPromptRef.current = message;
    }
    setWorkingWord(theme.workingWords[Math.floor(Math.random() * theme.workingWords.length)]);
    stick(); // sending jumps to the new message
    setTurns((prev) => [
      ...prev,
      { id: nextTurnId(), role: "user", blocks: [{ kind: "text", text: message }] },
      { id: nextTurnId(), role: "assistant", blocks: [] },
    ]);
    runningRef.current = true;
    setRunning(true);
    const res = await agent.chat.start(sessionId, {
      prompt,
      vaultId,
      docId,
      docPath,
      resume: providerSessionRef.current ?? undefined,
    });
    if (!res.ok) {
      runningRef.current = false;
      setRunning(false);
      setFatal(
        res.error === "vault-not-mounted"
          ? "This vault isn't mounted on this machine."
          : res.error ?? "Couldn't start the agent."
      );
    }
  }, [agent, sessionId, vaultId, docId, docPath, theme.workingWords, activeSelection, stick]);

  /**
   * The composer's submit. While a run is in flight the message is QUEUED rather
   * than dropped — waiting for the agent to finish before you are allowed to type
   * the next thing loses the thought you had while reading its answer.
   */
  const submit = useCallback(() => {
    const message = input.trim();
    if (!message || !agent) return;
    setInput("");
    if (running) {
      setQueue((q) => [...q, message]);
      return;
    }
    void sendMessage(message);
  }, [input, running, agent, sendMessage]);

  // Drain one queued message when the run ends. One at a time and in order: each
  // needs the previous run's session id to resume from, which only exists once
  // that run has finished.
  useEffect(() => {
    if (running || queue.length === 0) return;
    const [next, ...rest] = queue;
    // Both in the async body: taking the message off the queue synchronously
    // while effects flush costs a render pass, and the send that follows is
    // asynchronous anyway.
    void (async () => {
      setQueue(rest);
      await sendMessage(next);
    })();
  }, [running, queue, sendMessage]);

  const stop = useCallback(() => {
    agent?.chat.cancel(sessionId);
    runningRef.current = false;
    setRunning(false);
    // Stopping means stop. Anything typed ahead was queued behind a run the user
    // has just decided against, so sending it now would be the opposite of asked.
    setQueue([]);
  }, [agent, sessionId]);

  // Refresh the history list (chats about THIS doc — the doc→sessions direction).
  const refreshSessions = useCallback(() => {
    if (!agent) return;
    void agent.sessions.list(vaultId, docId).then(setSessions).catch(() => setSessions([]));
  }, [agent, vaultId, docId]);

  // Start a fresh conversation, forgetting the current thread's resume/record.
  const newChat = useCallback(() => {
    if (running) return;
    clearCurrentSession(vaultId);
    providerSessionRef.current = null;
    recordIdRef.current = null;
    createdAtRef.current = null;
    firstPromptRef.current = "";
    stick();
    setTurns([]);
    setUsage(null);
    setFatal(null);
  }, [running, vaultId, stick]);

  // Reopen a past session: render its transcript (from ~/.claude) and set up resume.
  const openSession = useCallback(
    async (meta: ChatSessionMeta) => {
      if (running || !agent) return;
      setLoadingSession(true);
      setFatal(null);
      const past = await agent.sessions.transcript(vaultId, meta.sessionId).catch(() => null);
      providerSessionRef.current = meta.sessionId;
      recordIdRef.current = meta.id;
      createdAtRef.current = meta.createdAt;
      firstPromptRef.current = meta.title;
      // Picking a conversation from history makes it the one you are having.
      setCurrentSession(vaultId, {
        recordId: meta.id,
        providerSessionId: meta.sessionId,
        createdAt: meta.createdAt,
        firstPrompt: meta.title,
      });
      setUsage(null);
      stick();
      setTurns(past ?? []);
      if (!past) setFatal("This conversation's transcript isn't on this machine — you can't resume it here.");
      setLoadingSession(false);
    },
    [running, agent, vaultId, stick]
  );

  const desktopReady = agent !== null;
  const Icon = theme.icon;

  return (
    <div
      className={cn(
        // 13px, not the 14px the editor uses. The panel is monospace for the
        // CLI agents, and a monospace face at a given size reads wider and
        // heavier than the editor's sans at the same size — matching the number
        // made the column look louder than the document beside it. This matches
        // what the eye sees rather than what the stylesheet says.
        "flex h-full w-full min-w-0 flex-col bg-background text-[13px]",
        !embedded && "border-l",
        theme.mono && "font-mono"
      )}
    >
      {/* A drag region on desktop: the window has no title bar of its own, so
          double-click-to-zoom and drag-to-move only work where the page says
          they do — and this strip holds nothing you can click, only the agent's
          name and its context meter. Without it, double-clicking the one header
          the panel has did nothing at all. */}
      <header
        className={cn(
          "flex shrink-0 items-center gap-2 px-3 py-2",
          isDesktop && "[-webkit-app-region:drag]"
        )}
      >
        <div
          className="grid size-6 place-items-center rounded-md"
          style={{ backgroundColor: theme.accent, color: theme.accentFg }}
        >
          <Icon className="size-4" />
        </div>
        <span className="truncate text-sm font-semibold">{agentName}</span>
        {usage && (
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {usage.percentage}% ctx
          </span>
        )}
      </header>

      <div
        ref={scrollRef}
        // overflow-x-hidden: the section never scrolls sideways — wide code/tool
        // output scrolls inside its own block instead (prose-pre/overflow-x-auto).
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4"
      >
        {/* The turns get their own element so its HEIGHT can be watched; the
            scroll container's own box never changes when content is added. */}
        <div ref={contentRef} className={theme.mono ? "space-y-3" : "space-y-4"}>
          {loadingSession && (
            <div className="flex justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {turns.length === 0 && !fatal && !loadingSession && (
            <p className="mt-8 text-center text-sm text-muted-foreground">
              {desktopReady ? theme.greeting : "Native agent chat runs in the Markbase desktop app."}
            </p>
          )}
          {turns.map((turn, i) => (
            <TurnView
              key={turn.id}
              turn={turn}
              theme={theme}
              working={running && i === turns.length - 1 ? workingWord : null}
              onOpenFile={onOpenFile}
            />
          ))}
          {fatal && <FailureNotice text={fatal} />}
        </div>
      </div>

      <form
        className="shrink-0 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div
          className={cn(
            "flex flex-col gap-2 border bg-muted/40 px-3 py-2 transition-colors",
            theme.userVariant === "prompt" ? "rounded-lg" : "rounded-xl"
          )}
        >
          {/* The document's current selection, offered as removable context. */}
          {activeSelection && (
            <div className="flex max-w-full items-center gap-1.5 self-start rounded-md border bg-background py-1 pl-2 pr-1 text-xs text-muted-foreground">
              <TextSelect className="size-3.5 shrink-0" style={{ color: theme.accent }} />
              <span className="max-w-[220px] truncate" title={activeSelection.quote}>
                {selectionLabel(activeSelection.quote)}
              </span>
              <button
                type="button"
                onClick={() => setDismissedQuote(activeSelection.quote)}
                aria-label="Remove selected text"
                className="grid size-4 shrink-0 place-items-center rounded hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
          {/* Queued while the agent works. Shown because a message that vanished
              into a queue you can't see is indistinguishable from one that was
              dropped — and each stays removable until it goes. */}
          {queue.map((q, i) => (
            <div
              key={`${i}-${q.slice(0, 24)}`}
              className="flex max-w-full items-center gap-1.5 self-start rounded-md border border-dashed bg-background py-1 pl-2 pr-1 text-xs text-muted-foreground"
            >
              <Clock3 className="size-3.5 shrink-0" />
              <span className="max-w-[220px] truncate" title={q}>
                {q}
              </span>
              <button
                type="button"
                onClick={() => setQueue((rest) => rest.filter((_, at) => at !== i))}
                aria-label={`Remove queued message ${q.slice(0, 40)}`}
                className="grid size-4 shrink-0 place-items-center rounded hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <textarea
            ref={box}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            // Esc stops the agent only while one is running, so it keeps its
            // usual meaning the rest of the time.
            // submitKeys BUILDS a handler and returns it; the refs `submit` and
            // `stop` reach are not touched until a key is actually pressed.
            // eslint-disable-next-line react-hooks/refs
            onKeyDown={submitKeys({
              onSubmit: submit,
              onEscape: running ? stop : undefined,
              multiline: true,
            })}
            rows={1}
            placeholder={
              !desktopReady
                ? "Open in the desktop app to chat"
                : running
                  ? "Reply now — it sends when the agent finishes (Esc to stop)"
                  : "Message the agent…"
            }
            disabled={!desktopReady}
            className="max-h-40 min-h-6 w-full resize-none overflow-y-auto bg-transparent outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          {/* Composer toolbar: past-chats + new-chat on the left, send on the right. */}
          <div className="flex items-center gap-0.5">
            <DropdownMenu onOpenChange={(open) => open && refreshSessions()}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={iconBtnCls} aria-label="Chat history">
                  <History className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                className="max-h-96 w-72 overflow-y-auto"
              >
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {docId ? "Chats about this doc" : "Chats in this vault"}
                </DropdownMenuLabel>
                {sessions.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">No saved chats yet.</div>
                ) : (
                  sessions.map((s) => (
                    <DropdownMenuItem
                      key={s.id}
                      onSelect={() => void openSession(s)}
                      className="flex flex-col items-start gap-0.5"
                      disabled={running}
                    >
                      <span className="w-full truncate font-medium">{s.title}</span>
                      <span className="text-[11px] text-muted-foreground">{formatWhen(s.updatedAt)}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={newChat}
              disabled={running}
              className={iconBtnCls}
              aria-label="New chat"
            >
              <SquarePen className="size-4" />
            </button>
            <div className="flex-1" />
            {running && (
              <button
                type="button"
                onClick={stop}
                className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background transition hover:opacity-90"
                aria-label="Stop (Esc)"
                title="Stop (Esc)"
              >
                <Square className="size-3.5" />
              </button>
            )}
            {/* Kept visible while running: the placeholder that explains queueing
                disappears the moment you type, so the button has to be the thing
                that says a reply can be sent now. */}
            {(!running || input.trim()) && (
              <button
                type="submit"
                disabled={!input.trim() || !desktopReady}
                className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:brightness-95 disabled:opacity-40"
                style={{ backgroundColor: theme.accent, color: theme.accentFg }}
                aria-label={running ? "Queue reply" : "Send"}
                title={running ? "Sends when the agent finishes" : "Send"}
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

/** Ticking seconds since `since`, or 0 when inactive. */
/** Seconds since this mounted, ticking once a second. */
function useElapsed(): number {
  const [secs, setSecs] = useState(0);
  // The clock is read where clocks belong — in the effect, after mounting — so
  // the render itself stays pure. It used to read Date.now() on every render and
  // keep the start in a ref seeded during render: two calls that answer
  // differently each time, in the one place that must not.
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return secs;
}

/**
 * Memoised, because switching document tabs re-renders the panel.
 *
 * The dock lives inside the doc view and takes the open document as a prop, so
 * changing tabs re-rendered every turn of the conversation — re-parsing the
 * markdown of an exchange that finished an hour ago, for a panel that looks
 * exactly the same afterwards. Only the newest turn actually changes: applyChunk
 * rebuilds the last turn and leaves the earlier ones by reference, and the other
 * three props are stable (a theme from a const map, a useCallback), so every
 * finished turn compares equal and is skipped.
 */
const TurnView = memo(function TurnView({
  turn,
  theme,
  working,
  onOpenFile,
}: {
  turn: Turn;
  theme: AgentTheme;
  working: string | null;
  onOpenFile?: (path: string, opts?: { newTab: boolean }) => void;
}) {
  if (turn.role === "user") {
    const text = turn.blocks.map((b) => ("text" in b ? b.text : "")).join("");
    if (theme.userVariant === "prompt") {
      // The CLI look: a coloured caret + the prompt echoed in the transcript.
      return (
        <div className="flex gap-2">
          <ChevronRight className="mt-0.5 size-4 shrink-0" style={{ color: theme.accent }} />
          <div className="min-w-0 whitespace-pre-wrap text-muted-foreground">{text}</div>
        </div>
      );
    }
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2"
          style={{ backgroundColor: theme.accent, color: theme.accentFg }}
        >
          {text}
        </div>
      </div>
    );
  }
  return (
    <div className={cn(theme.mono ? "space-y-1.5" : "space-y-2")}>
      {turn.blocks.map((b, i) => (
        <BlockView key={i} block={b} theme={theme} onOpenFile={onOpenFile} />
      ))}
      {working && <WorkingLine theme={theme} word={working} />}
    </div>
  );
});

function WorkingLine({ theme, word }: { theme: AgentTheme; word: string }) {
  const secs = useElapsed();
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <CircleDot className="size-3.5 shrink-0 animate-pulse" style={{ color: theme.accent }} />
      <span>
        {word}
        <AnimatedEllipsis /> {secs > 0 && <span className="tabular-nums opacity-60">({secs}s)</span>}
      </span>
    </div>
  );
}

function AnimatedEllipsis() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v % 3) + 1), 400);
    return () => clearInterval(t);
  }, []);
  return <span>{".".repeat(n)}</span>;
}

function BlockView({
  block,
  theme,
  onOpenFile,
}: {
  block: Block;
  theme: AgentTheme;
  onOpenFile?: (path: string, opts?: { newTab: boolean }) => void;
}) {
  switch (block.kind) {
    case "text":
      // Agent replies are markdown — render them. Keep the theme font (so Claude
      // Code's markdown stays monospace/terminal) and tighten spacing for chat.
      // File-path-shaped inline code becomes a clickable jump (onOpenFile).
      return (
        <Markdown
          content={block.text}
          onOpenFile={onOpenFile}
          className={cn(
            // `text-[13px]` has to sit HERE. The shared Markdown carries
            // `prose-sm`, which sets a font-size on its own root, so a size set
            // on any ancestor is simply not inherited through it.
            "max-w-none break-words text-[13px] prose-pre:overflow-x-auto prose-pre:my-2 prose-p:my-2 prose-headings:my-2",
            theme.mono
              ? "font-mono prose-headings:text-[1em] prose-headings:font-semibold prose-pre:text-[0.95em]"
              : undefined
          )}
        />
      );
    case "thinking":
      return (
        <div
          className="whitespace-pre-wrap border-l-2 pl-3 italic text-muted-foreground"
          style={{ borderColor: `${theme.accent}66` }}
        >
          {block.text}
        </div>
      );
    case "tool":
      return theme.toolVariant === "terminal" ? (
        <TerminalToolBlock block={block} theme={theme} onOpenFile={onOpenFile} />
      ) : (
        <CardToolBlock block={block} onOpenFile={onOpenFile} />
      );
    case "error":
      return <FailureNotice text={block.text} />;
    case "notice":
      return (
        <div
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs",
            block.level === "warning"
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          {block.text}
        </div>
      );
  }
}

/**
 * Click the opened block to close it again.
 *
 * The tool's name toggles it, but once a wall of output is on screen that name
 * is far away and easy to lose; the natural move is to click the thing you
 * opened. Selecting text is the OTHER reason to open a result, though, and a
 * click that ends a drag would swallow the selection — so a click that leaves
 * text selected is left alone.
 *
 * Not focusable: the name button is already the keyboard path to the same
 * toggle, and a second tab stop over the same control just makes the panel
 * longer to walk through.
 */
function closeOnClick(setOpen: (open: boolean) => void): () => void {
  return () => {
    if (!window.getSelection()?.toString()) setOpen(false);
  };
}

/**
 * A failure, said in words.
 *
 * What arrives is written for a terminal — `API Error: 500 {"type":"error",…}` —
 * and printed as-is it answers none of the three questions a person has: what
 * happened, whose fault it is, and whether trying again is worth anything. So
 * the panel leads with that, and keeps the original a click away rather than
 * throwing it out: an error we have not seen before is exactly the one somebody
 * will need to read in full.
 */
function FailureNotice({ text }: { text: string }) {
  const { title, hint, retryable } = explainFailure(text);
  const [showRaw, setShowRaw] = useState(false);
  // Nothing to expand when the headline already IS the message — an
  // unrecognised error is quoted rather than summarised.
  const hasMore = text.trim() !== title;
  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-[3px] size-3.5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-destructive">{title}</div>
          {hint && <div className="mt-0.5 text-muted-foreground">{hint}</div>}
          {!hint && retryable && (
            <div className="mt-0.5 text-muted-foreground">Sending it again is safe.</div>
          )}
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              {showRaw ? "Hide details" : "Details"}
            </button>
          )}
          {showRaw && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

type ToolFields = { name: string; input: Record<string, unknown>; result?: string; isError?: boolean };

// The CLI look: `⏺ Tool(arg)` with a coloured bullet, then a `⎿` continuation
// line previewing the result. Click to expand the full input + output.
function TerminalToolBlock({
  block,
  theme,
  onOpenFile,
}: {
  block: ToolFields;
  theme: AgentTheme;
  onOpenFile?: (path: string, opts?: { newTab: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(block.input);
  const filePath = toolFilePath(block.input);
  const preview = useMemo(
    () => (block.result ? previewOf(block.result) : null),
    [block.result]
  );
  return (
    // A step under the prose it sits between — a tool call is the smallest
    // thing on the row, as befits what it is.
    <div className="text-[12px] leading-relaxed">
      <div className="flex w-full items-start gap-2">
        {/* The tool's name does not shrink. With min-w-0 and nothing to truncate
            it, flex squeezed this button below its text, which then overflowed on
            top of the path beside it — "Edit" and "/Users/…" printed over each
            other. The path is what should give way, and it can: it truncates. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex shrink-0 items-start gap-2 text-left"
        >
          {/* A tool call is a footnote to the answer, not a heading in it. It
              was bold, full-contrast and dotted in the agent's accent — so a
              turn that used six tools read as six headings with prose wedged
              between them. Same shapes, stepped back a level: a smaller dot at
              partial strength, regular weight, secondary text. An error keeps
              its colour, because that one IS worth looking at. */}
          <CircleDot
            className={cn("mt-[3px] size-2.5 shrink-0", !block.isError && "opacity-70")}
            style={{ color: block.isError ? undefined : theme.accent }}
          />
          <span className="text-muted-foreground">{block.name}</span>
        </button>
        {filePath && onOpenFile ? (
          <button
            type="button"
            onClick={(e) => onOpenFile(filePath, { newTab: e.metaKey || e.ctrlKey })}
            title={`Open ${filePath}`}
            className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground hover:underline"
          >
            ({summary})
          </button>
        ) : summary ? (
          // A shade under the name, so the row still reads name-then-argument
          // now that the name has stepped back too.
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">({summary})</span>
        ) : null}
      </div>
      {(preview || open) && (
        <div className="mt-0.5 flex gap-2 pl-1">
          <CornerDownRight className="mt-[3px] size-3.5 shrink-0 text-muted-foreground/50" />
          <div className="min-w-0 flex-1">
            {open ? (
              <div className="cursor-pointer space-y-1.5" onClick={closeOnClick(setOpen)}>
                <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                  {JSON.stringify(block.input, null, 2)}
                </pre>
                {block.result != null && (
                  <pre
                    className={cn(
                      "max-h-72 overflow-auto whitespace-pre-wrap",
                      block.isError ? "text-destructive" : "text-muted-foreground"
                    )}
                  >
                    {block.result}
                  </pre>
                )}
              </div>
            ) : (
              /* `line-clamp-1`, not `truncate`. Both set white-space, and
                 `whitespace-pre-wrap` won: the preview never truncated, it
                 WRAPPED. One `gh --json` result is a single line of JSON, so a
                 "one line" preview rendered as ~19, burying the conversation
                 under a tool it had already finished. line-clamp counts
                 RENDERED lines, so it holds at one however the text wraps.
                 The row is a button too — a preview you cannot tell is
                 expandable is just a truncated result. */
              <button
                type="button"
                onClick={() => setOpen(true)}
                title="Show the full input and output"
                className="block w-full cursor-pointer text-left"
              >
                <pre
                  className={cn(
                    "line-clamp-1 break-words whitespace-pre-wrap",
                    block.isError ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {preview}
                </pre>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The chat look (Cursor / Claude Desktop): an expandable tool card.
function CardToolBlock({
  block,
  onOpenFile,
}: {
  block: ToolFields;
  onOpenFile?: (path: string, opts?: { newTab: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = summarizeToolInput(block.input);
  const filePath = toolFilePath(block.input);
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30 text-xs">
      <div className="flex w-full items-center gap-1.5 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-left"
        >
          <ChevronRight className={cn("size-3.5 shrink-0 transition", open && "rotate-90")} />
          <span className="font-medium">{block.name}</span>
        </button>
        {filePath && onOpenFile ? (
          <button
            type="button"
            onClick={(e) => onOpenFile(filePath, { newTab: e.metaKey || e.ctrlKey })}
            title={`Open ${filePath}`}
            className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline"
          >
            {summary}
          </button>
        ) : summary ? (
          <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
        ) : null}
        {block.isError && <span className="ml-auto shrink-0 text-destructive">error</span>}
      </div>
      {open && (
        <div
          className="cursor-pointer space-y-2 border-t px-2.5 py-2"
          onClick={closeOnClick(setOpen)}
        >
          <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
            {JSON.stringify(block.input, null, 2)}
          </pre>
          {block.result != null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t pt-2">
              {block.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Enough to fill the one line we show; the rest never leaves the string. A tool
 *  can return megabytes on one line, and clipping it in CSS still hands all of it
 *  to the DOM. */
const PREVIEW_CHARS = 400;

/**
 * The one line of a result worth showing next to the tool that produced it.
 *
 * Not its first line: a JSON result's first line is `[`, so a column of tool
 * calls previewed as a column of single brackets — taking a row each to say
 * nothing. Whitespace is collapsed instead, so the preview starts at the first
 * thing that IS content whatever the result's shape.
 */
function previewOf(result: string): string {
  // Sliced BEFORE the collapse, not after. Collapsing first walked the entire
  // result — half a megabyte of JSON is normal — to keep 400 characters of it,
  // on every render of a block that had long since finished. Measured at 20ms
  // per render across twenty tool calls; 0.05ms this way. Four times the chars
  // we keep is far more than any run of whitespace at the front.
  return result.slice(0, PREVIEW_CHARS * 4).replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);
}

// The openable file a tool acted on (Read/Write/Edit/NotebookEdit), if any — so
// its path in the tool line can jump to that doc.
function toolFilePath(input: Record<string, unknown>): string | null {
  for (const key of ["file_path", "path", "notebook_path"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function summarizeToolInput(input: Record<string, unknown>): string {
  const first = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.prompt;
  if (typeof first === "string") return first.length > 60 ? first.slice(0, 60) + "…" : first;
  return "";
}
