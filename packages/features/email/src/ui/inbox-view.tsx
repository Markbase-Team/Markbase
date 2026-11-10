"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Letter } from "react-letter";
import {
  Bell,
  ExternalLink,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
} from "lucide-react";
import type {
  EmailAccountPublic,
  InboxMessageFull,
  InboxMessageSummary,
} from "../server";
import { Button } from "@markbase/ui/button";
import { UnsubscribeButton } from "./unsubscribe-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@markbase/ui/select";
import { cn } from "@markbase/ui/utils";

const CONNECT_URL = "/api/v1/email/oauth/start";

// Drag data type for an email row → dropped onto the Attention sidebar region,
// which classifies + files it. Kept in sync with the sidebar's drop handler
// (apps/web/src/components/app-sidebar.tsx).
const INBOX_EMAIL_DND = "application/x-inbox-email";

// "Ada Lovelace <ada@example.com>" → "Ada Lovelace"; bare address → the address.
function displayFrom(from: string): string {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match && match[1].trim()) return match[1].trim();
  if (match) return match[2].trim();
  return from;
}

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function InboxView() {
  const [accounts, setAccounts] = useState<EmailAccountPublic[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [messages, setMessages] = useState<InboxMessageSummary[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<InboxMessageFull | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);
  // Gmail message ids already filed onto an Attention board (for the row flag).
  const [filedIds, setFiledIds] = useState<Set<string>>(new Set());

  const account = accounts.find((a) => a.id === accountId) ?? null;

  // Surface the OAuth result, then strip the query so it doesn't repeat.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast.success(`Connected ${connected}`);
    if (error) toast.error(`Couldn't connect: ${error}`);
    if (connected || error) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Track Attention membership: load once, and update instantly when a drop
  // files an email (the sidebar dispatches "attention-filed").
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/attention/filed");
        const data: { messageIds?: string[] } = await res.json();
        if (active) setFiledIds(new Set(data.messageIds ?? []));
      } catch {
        // Non-critical — leave rows unflagged if this fails.
      }
    })();
    const onFiled = (e: Event) => {
      const id = (e as CustomEvent<{ messageId?: string }>).detail?.messageId;
      if (id) setFiledIds((prev) => new Set(prev).add(id));
    };
    window.addEventListener("attention-filed", onFiled);
    return () => {
      active = false;
      window.removeEventListener("attention-filed", onFiled);
    };
  }, []);

  const loadList = useCallback(async (id: string) => {
    setLoadingList(true);
    setMessages([]);
    setNextPageToken(null);
    setSelectedId(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/inbox?account=${id}`);
      const data: {
        messages?: InboxMessageSummary[];
        nextPageToken?: string | null;
        error?: string;
      } = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      setMessages(data.messages ?? []);
      setNextPageToken(data.nextPageToken ?? null);
    } catch {
      toast.error("Failed to load inbox");
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Selecting an account (switcher or initial) loads its inbox. Kept out of an
  // effect so we don't setState synchronously on render.
  const selectAccount = useCallback(
    (id: string) => {
      setAccountId(id);
      loadList(id);
    },
    [loadList]
  );

  // Load connected accounts on mount; auto-select + load the first.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/inbox/accounts");
        const data: { accounts?: EmailAccountPublic[]; error?: string } =
          await res.json();
        if (!active) return;
        const list = data.accounts ?? [];
        setAccounts(list);
        if (list.length > 0) selectAccount(list[0].id);
      } catch {
        if (active) toast.error("Failed to load accounts");
      } finally {
        if (active) setLoadingAccounts(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectAccount]);

  async function loadMore() {
    if (!accountId || !nextPageToken) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/v1/inbox?account=${accountId}&pageToken=${encodeURIComponent(
          nextPageToken
        )}`
      );
      const data: {
        messages?: InboxMessageSummary[];
        nextPageToken?: string | null;
      } = await res.json();
      setMessages((prev) => [...prev, ...(data.messages ?? [])]);
      setNextPageToken(data.nextPageToken ?? null);
    } catch {
      toast.error("Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  // Mark a message read in Gmail and optimistically un-bold its row. Reverts if
  // the request fails (e.g. account still on the old read-only scope).
  async function markRead(id: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, unread: false } : m))
    );
    try {
      const res = await fetch("/api/v1/inbox/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: accountId, id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, unread: true } : m))
      );
      toast.error("Couldn't mark as read — reconnect the account to allow it.");
    }
  }

  async function openMessage(id: string) {
    if (!accountId) return;
    setSelectedId(id);
    setMessage(null);
    setLoadingMessage(true);
    try {
      const res = await fetch(
        `/api/v1/inbox/message?account=${accountId}&id=${id}`
      );
      const data: { message?: InboxMessageFull; error?: string } =
        await res.json();
      if (data.error || !data.message) {
        toast.error(data.error ?? "Failed to open message");
        return;
      }
      setMessage(data.message);
      if (data.message.unread) markRead(id);
    } catch {
      toast.error("Failed to open message");
    } finally {
      setLoadingMessage(false);
    }
  }

  // Deep-link to the message. `authuser=<email>` lets Gmail resolve which
  // signed-in account to use (the /mail/u/<N>/ path needs a numeric index, not
  // an email — passing an email there triggers Gmail's "account unavailable").
  const gmailUrl =
    account && message
      ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(
          account.email_address
        )}#all/${message.id}`
      : null;

  return (
    <main className="flex h-full w-full min-w-0 flex-col px-3 py-3">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Mail className="size-5" />
          Inbox
        </h1>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <>
              <Select value={accountId} onValueChange={selectAccount}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.email_address}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => accountId && loadList(accountId)}
                disabled={loadingList}
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCw
                  className={cn("size-4", loadingList && "animate-spin")}
                />
              </Button>
            </>
          )}
          <Button asChild variant="outline">
            <a href={CONNECT_URL}>
              <Plus className="size-4" />
              Connect account
            </a>
          </Button>
        </div>
      </div>

      {loadingAccounts ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <Mail className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No Gmail accounts connected yet.
          </p>
          <Button asChild>
            <a href={CONNECT_URL}>
              <Plus className="size-4" />
              Connect a Gmail account
            </a>
          </Button>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-lg border md:grid-cols-[340px_1fr]">
          {/* Message list */}
          <div className="flex min-h-0 flex-col border-b md:border-b-0 md:border-r">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadingList ? (
                <div className="flex h-40 items-center justify-center text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No messages.
                </p>
              ) : (
                <ul className="divide-y">
                  {messages.map((m) => (
                    <li key={m.id}>
                      <button
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "copy";
                          e.dataTransfer.setData(
                            INBOX_EMAIL_DND,
                            JSON.stringify({
                              account_id: accountId,
                              message_id: m.id,
                              thread_id: m.threadId,
                              from: m.from,
                              subject: m.subject,
                              snippet: m.snippet,
                              date: m.date,
                            })
                          );
                        }}
                        onClick={() => openMessage(m.id)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-muted/60",
                          selectedId === m.id && "bg-muted"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {m.unread && (
                            <span className="size-2 shrink-0 rounded-full bg-primary" />
                          )}
                          <span
                            className={cn(
                              "flex-1 truncate text-sm",
                              m.unread ? "font-bold" : "font-normal"
                            )}
                          >
                            {displayFrom(m.from)}
                          </span>
                          {filedIds.has(m.id) && (
                            <Bell
                              className="size-3.5 shrink-0 fill-violet-500 text-violet-500"
                              aria-label="In Attention"
                            />
                          )}
                          <span
                            className={cn(
                              "shrink-0 text-xs",
                              m.unread
                                ? "font-semibold text-foreground"
                                : "text-muted-foreground"
                            )}
                          >
                            {formatDate(m.date)}
                          </span>
                        </div>
                        <span
                          className={cn(
                            "truncate text-sm",
                            m.unread ? "font-semibold" : "font-normal"
                          )}
                        >
                          {m.subject || "(no subject)"}
                        </span>
                        <span
                          className={cn(
                            "truncate text-xs",
                            m.unread
                              ? "text-foreground/70"
                              : "text-muted-foreground"
                          )}
                        >
                          {m.snippet}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {nextPageToken && (
              <div className="border-t p-2">
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </div>

          {/* Reading pane */}
          <div className="min-h-0 overflow-y-auto">
            {loadingMessage ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : !message ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Select a message to read it.
              </div>
            ) : (
              <article className="p-6">
                <h2 className="text-base font-semibold">
                  {message.subject || "(no subject)"}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <span>{message.from}</span>
                  <span className="size-1 rounded-full bg-muted-foreground/40" />
                  <span>{formatDate(message.date)}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <UnsubscribeButton
                      accountId={accountId}
                      messageId={message.id}
                      info={message.unsubscribe}
                    />
                    {gmailUrl && (
                      <a
                        href={gmailUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-foreground hover:underline"
                      >
                        <ExternalLink className="size-3.5" />
                        Open in Gmail
                      </a>
                    )}
                  </div>
                </div>
                <hr className="my-4" />
                {message.html ? (
                  <Letter
                    html={message.html}
                    className="text-sm [&_a]:text-blue-600 [&_img]:max-w-full"
                  />
                ) : (
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {message.body || "(no content)"}
                  </div>
                )}
              </article>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
