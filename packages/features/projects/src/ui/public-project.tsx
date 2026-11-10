"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";
import { Textarea } from "@markbase/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@markbase/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { ImageUpload } from "./image-upload";
import { AttachmentThumb } from "./attachment-thumb";
import { OwnerBadge, StatusBadge } from "./status-badge";
import { uploadImages } from "@markbase/protocol/upload";
import type { Project, Ticket } from "@markbase/protocol/types";

export function ProjectClient({
  project,
  initialTickets,
}: {
  project: Project;
  initialTickets: Ticket[];
}) {
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  // Editing: kept existing image URLs + newly picked files.
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editFiles, setEditFiles] = useState<File[]>([]);

  const base = `/api/projects/${project.slug}/tickets`;

  function startEdit(t: Ticket) {
    setEditing(t);
    setEditImages(t.images ?? []);
    setEditFiles([]);
  }

  function cancelEdit() {
    setEditing(null);
    setEditImages([]);
    setEditFiles([]);
  }

  async function refresh() {
    const res = await fetch(base, { cache: "no-store" });
    const data = await res.json();
    setTickets(data.tickets ?? []);
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    setSubmitting(true);
    let images: string[] = [];
    try {
      images = await uploadImages(files, project.slug);
    } catch {
      setSubmitting(false);
      toast.error("Image upload failed");
      return;
    }

    const payload = {
      title: String(fd.get("title") ?? ""),
      requester: String(fd.get("requester") ?? ""),
      description: String(fd.get("description") ?? ""),
      images,
    };

    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSubmitting(false);

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      toast.error(error ?? "Failed to submit request");
      return;
    }
    form.reset();
    setFiles([]);
    setCreating(false);
    toast.success("Request submitted");
    refresh();
  }

  async function handleEditSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);

    let newUrls: string[] = [];
    try {
      newUrls = await uploadImages(editFiles, project.slug);
    } catch {
      toast.error("Image upload failed");
      return;
    }

    const payload = {
      title: String(fd.get("title") ?? ""),
      requester: String(fd.get("requester") ?? ""),
      description: String(fd.get("description") ?? ""),
      images: [...editImages, ...newUrls],
    };
    const res = await fetch(`${base}/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      toast.error("Failed to update");
      return;
    }
    cancelEdit();
    toast.success("Request updated");
    refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this request?")) return;
    const res = await fetch(`${base}/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete");
      return;
    }
    toast.success("Request deleted");
    refresh();
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {project.name} requests
        </h1>
        <Button onClick={() => setCreating(true)} className="shrink-0">
          <Plus className="size-4" />
          New request
        </Button>
      </div>

      {/* New request — full screen on mobile, a centered dialog on sm+. */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New request</DialogTitle>
            <DialogDescription>
              Describe what you need. In the description, include the resources
              required to complete the task.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" required placeholder="Short summary of the request" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="requester">Your name</Label>
              <Input id="requester" name="requester" required placeholder="Who is requesting this?" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                required
                rows={5}
                placeholder="What needs to be done, and what resources are required to complete it (data, access, budget, people, tools)?"
              />
            </div>
            <ImageUpload files={files} onFilesChange={setFiles} />
            {/* Centered dialog on sm+ pins the submit; mobile flows it under the
                form (no floating gap). pb respects the iOS safe area. */}
            <div className="-mx-4 -mb-4 border-t bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:sticky sm:bottom-0">
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? "Submitting…" : "Submit request"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ticket list */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {tickets.length} request{tickets.length === 1 ? "" : "s"}
        </h2>
        <div className="space-y-4">
          {tickets.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No requests yet. Submit the first one above.
            </p>
          )}
          {tickets.map((t) =>
            editing?.id === t.id ? (
              <Card key={t.id}>
                <form onSubmit={handleEditSave}>
                  <CardContent className="space-y-4 pt-6">
                    <div className="space-y-2">
                      <Label htmlFor={`title-${t.id}`}>Title</Label>
                      <Input id={`title-${t.id}`} name="title" defaultValue={t.title} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`req-${t.id}`}>Your name</Label>
                      <Input id={`req-${t.id}`} name="requester" defaultValue={t.requester} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`desc-${t.id}`}>Description</Label>
                      <Textarea
                        id={`desc-${t.id}`}
                        name="description"
                        rows={5}
                        defaultValue={t.description}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      {editImages.length > 0 && (
                        <>
                          <Label>Current attachments</Label>
                          <div className="flex flex-wrap gap-2">
                            {editImages.map((url, i) => (
                              <AttachmentThumb
                                key={url}
                                url={url}
                                onRemove={() =>
                                  setEditImages((prev) =>
                                    prev.filter((_, idx) => idx !== i)
                                  )
                                }
                              />
                            ))}
                          </div>
                        </>
                      )}
                      <ImageUpload
                        id={`edit-images-${t.id}`}
                        label={
                          editImages.length
                            ? "Add attachments"
                            : "Screenshots or PDFs (optional)"
                        }
                        files={editFiles}
                        onFilesChange={setEditFiles}
                      />
                    </div>
                  </CardContent>
                  <CardFooter className="mt-4 gap-2">
                    <Button type="submit" size="sm">Save</Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </Button>
                  </CardFooter>
                </form>
              </Card>
            ) : (
              <Card key={t.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-lg">{t.title}</CardTitle>
                    <div className="flex shrink-0 gap-2">
                      <StatusBadge status={t.status} />
                      {/* Coarse label only — never expose agent names publicly. */}
                      <OwnerBadge label={t.owner_kind === "agent" ? "Agent" : "Team"} />
                    </div>
                  </div>
                  <CardDescription>Requested by {t.requester}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p className="whitespace-pre-wrap">{t.description}</p>
                  {t.images?.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {t.images.map((url, i) => (
                        <AttachmentThumb key={i} url={url} className="size-20" />
                      ))}
                    </div>
                  )}
                </CardContent>
                <CardFooter className="mt-2 gap-2">
                  <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(t.id)}
                  >
                    Delete
                  </Button>
                </CardFooter>
              </Card>
            )
          )}
        </div>
      </section>
    </main>
  );
}
