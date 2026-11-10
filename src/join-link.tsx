"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import { api } from "@markbase/protocol/api-client";
import { Button } from "./button";
import { CopyButton } from "./copy-button";
import { Input } from "./input";
import { cn } from "./utils";

// Inviting a teammate, in Settings in the web and desktop shells, open to
// anyone signed in (there is no admin role yet). Two steps, no mail: add the
// teammate's address, which puts it on the instance's invite list (POST
// /api/v1/instance/invite/email), then hand them the join link however the
// team talks. The join page creates an account for an address on the list
// and nobody else. "New link" rotates the code the link carries, so a link
// that leaked stops working. Not on the hosted app, whose sign-up is open.

/** GET /api/v1/instance/invite. */
interface InviteInfo {
  join_url: string;
  pending: { email: string; created_at: string }[];
  /** The caller set this instance up: its first account, the admin. */
  admin: boolean;
}

export function JoinLinkField({ className }: { className?: string }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.json<InviteInfo>("/api/v1/instance/invite").then(
      (next) => live && setInfo(next),
      (e: Error) => live && setError(e.message)
    );
    return () => {
      live = false;
    };
  }, []);

  // The list as the server has it now — after a refusal, which may mean the
  // address joined since the list was fetched.
  function refresh() {
    void api.json<InviteInfo>("/api/v1/instance/invite").then(setInfo, () => {});
  }

  async function rotate() {
    setBusy(true);
    setError(null);
    await api.json<InviteInfo>("/api/v1/instance/invite/rotate", { method: "POST" }).then(
      (next) => {
        setInfo(next);
        setConfirm(false);
      },
      (e: Error) => setError(e.message)
    );
    setBusy(false);
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setAdding(true);
    setAddError(null);
    await api
      .json<InviteInfo>("/api/v1/instance/invite/email", {
        method: "POST",
        body: JSON.stringify({ email: address }),
      })
      .then(
        (next) => {
          setInfo(next);
          setEmail("");
        },
        (err: Error) => {
          setAddError(err.message);
          refresh();
        }
      );
    setAdding(false);
  }

  async function remove(address: string) {
    setAddError(null);
    await api
      .json<InviteInfo>("/api/v1/instance/invite/email", {
        method: "DELETE",
        body: JSON.stringify({ email: address }),
      })
      .then(setInfo, (err: Error) => setAddError(err.message));
  }

  const link = info?.join_url ?? null;
  const host = link ? new URL(link).host : null;
  const pending = info?.pending ?? [];
  return (
    <section className={cn("space-y-3", className)}>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Invite your team</h3>
        <p className="text-sm text-muted-foreground">
          {info?.admin && (
            <>
              You set this instance up, so you are its admin.{" "}
            </>
          )}
          Add a teammate's address, then send them the link below. It creates an account on{" "}
          <span className="font-medium text-foreground">{host ?? "this instance"}</span> for an
          address on this list, and nobody else.
        </p>
        <form onSubmit={add} className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            autoComplete="off"
            disabled={adding}
            aria-label="Email address to invite"
          />
          <Button type="submit" variant="outline" disabled={adding || !email.trim()}>
            <Plus className="size-4" />
            {adding ? "Adding…" : "Add"}
          </Button>
        </form>
        {addError && <p className="text-xs text-destructive">{addError}</p>}
        {pending.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Invited, not joined yet">
            {pending.map((p) => (
              <li
                key={p.email}
                className="flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2 text-xs"
              >
                <span>{p.email}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-5 text-muted-foreground"
                  aria-label={`Withdraw the invite for ${p.email}`}
                  onClick={() => void remove(p.email)}
                >
                  <X className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            readOnly
            value={link ?? ""}
            placeholder="…"
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
            aria-label="Invite link"
          />
          <CopyButton text={link ?? ""} />
        </div>
        {confirm ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Links already sent stop working.</span>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void rotate()}>
              {busy ? "Rotating…" : "Rotate"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={!link}
            onClick={() => setConfirm(true)}
          >
            <RefreshCw className="size-4" />
            New link
          </Button>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}
