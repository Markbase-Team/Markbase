"use client";

import { api } from "@markbase/protocol/api-client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@markbase/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@markbase/ui/select";

type LinkRow = {
  id: string;
  token: string;
  mode: "member" | "guest";
  capability: string;
  url: string;
};

const MODE_LABEL: Record<string, string> = {
  member: "Members (sign-in required)",
  guest: "Anyone with the link (guest)",
};

const CAP_LABEL: Record<string, string> = {
  editor: "Can edit",
  commenter: "Can comment",
  viewer: "Can view",
};

export function ShareDialog({
  docId,
  open,
  onOpenChange,
}: {
  docId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [mode, setMode] = useState<"member" | "guest">("guest");
  const [capability, setCapability] = useState("commenter");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.request(`/api/v1/docs/${docId}/links`)
      .then((r) => r.json())
      .then((d: { links: LinkRow[] }) => setLinks(d.links ?? []))
      .catch(() => {});
  }, [docId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Guests can't edit — keep the capability valid when switching to guest.
  function changeMode(next: "member" | "guest") {
    setMode(next);
    if (next === "guest" && capability === "editor") setCapability("commenter");
  }

  async function create() {
    setCreating(true);
    try {
      const res = await api.request(`/api/v1/docs/${docId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, capability }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(error ?? "Failed to create link");
        return;
      }
      const { link } = await res.json();
      await navigator.clipboard.writeText(link.url).catch(() => {});
      toast.success("Link created and copied");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  async function revoke(id: string) {
    await api.request(`/api/v1/docs/${docId}/links/${id}`, { method: "DELETE" });
    load();
  }

  const capOptions =
    mode === "guest"
      ? ["commenter", "viewer"]
      : ["editor", "commenter", "viewer"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share document</DialogTitle>
          <DialogDescription>
            Create a link. Member links add the person as a collaborator on
            sign-in; guest links open a review page with no account.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[220px] flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Access
            </span>
            <Select value={mode} onValueChange={(v) => changeMode(v as "member" | "guest")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{MODE_LABEL.member}</SelectItem>
                <SelectItem value="guest">{MODE_LABEL.guest}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-[150px] flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Role
            </span>
            <Select value={capability} onValueChange={setCapability}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {capOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CAP_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={create} disabled={creating}>
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Link2 className="size-4" />
            )}
            Create link
          </Button>
        </div>

        {links.length > 0 && (
          <div className="mt-2 space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Active links
            </span>
            <ul className="divide-y rounded-lg border">
              {links.map((l) => (
                <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{CAP_LABEL[l.capability]}</span>{" "}
                    <span className="text-muted-foreground">
                      · {l.mode === "guest" ? "guest" : "member"}
                    </span>
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => copy(l.url)}
                    aria-label="Copy link"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => revoke(l.id)}
                    aria-label="Revoke link"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
