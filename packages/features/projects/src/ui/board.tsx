"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createSupabaseBrowserClient } from "@markbase/protocol/browser";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Bot,
  Copy,
  Download,
  Eye,
  FileText,
  Folder,
  GitBranch,
  GitPullRequest,
  Globe,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Label } from "@markbase/ui/label";
import { Textarea } from "@markbase/ui/textarea";
import { ImageUpload } from "./image-upload";
import { AttachmentThumb } from "./attachment-thumb";
import { STATUS_STYLES } from "./status-badge";
import { PRIORITY_VALUE_COLORS } from "./property-color";
import { uploadImages } from "@markbase/protocol/upload";
import { cachedGet, peekGet, primeCache, refreshGet } from "@markbase/ui/app-cache";
import { cn } from "@markbase/ui/utils";
import { useNavigation } from "@markbase/ui/navigation";
import type {} from "./routes";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@markbase/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Kanban, type KanbanColumn, type KanbanChange } from "@markbase/ui/kanban";
import { ProjectTabs } from "./project-tabs";
import { AppHeader } from "@markbase/ui/app-header";
import { useProjects } from "./projects-context";
import { TicketChat } from "./ticket-chat";
import { MarkdownEditor } from "@markbase/ui/markdown-editor";
import {
  ManagePropertiesDialog,
  PropertyValueEditor,
} from "./ticket-properties";
import {
  cleanNameList,
  TICKET_STATUSES,
  STATUS_LABELS,
  type OwnerKind,
  type Project,
  type ProjectProperty,
  type Ticket,
  type TicketStatus,
} from "@markbase/protocol/types";
import {
  useAgentSessions,
  ownerOptions,
  ownerMatchesFilter,
} from "@markbase/ui/use-agent-sessions";
import { AssigneePicker } from "./assignee-picker";

const ALL = "all";
const TICKETS_URL = "/api/v1/tickets";
/** Collapse the duplicate ticket fetches a remount fires, without going stale. */
const TICKETS_DEDUPE_MS = 2_000;
const propertiesUrl = (slug: string) => `/api/admin/projects/${slug}/properties`;

// Client-side filter + sort over the full ticket list, mirroring the server
// (api/admin/tickets + core listTickets): filter by project / owner / a
// property value; sort by a property (unset values last, in both directions),
// otherwise newest-first by created_at.
function filterAndSortTickets(
  all: Ticket[],
  f: {
    project: string;
    owner: string;
    filterProp: string;
    filterValue: string;
    sortProp: string;
    sortDir: "asc" | "desc";
  }
): Ticket[] {
  let out = all;
  if (f.project !== ALL) out = out.filter((t) => t.project === f.project);
  if (f.owner !== ALL) out = out.filter((t) => ownerMatchesFilter(t, f.owner));
  if (f.filterProp !== ALL && f.filterValue !== ALL) {
    out = out.filter((t) => t.properties?.[f.filterProp] === f.filterValue);
  }

  const sorted = [...out];
  if (f.sortProp !== ALL) {
    sorted.sort((a, b) => {
      const av = a.properties?.[f.sortProp] ?? "";
      const bv = b.properties?.[f.sortProp] ?? "";
      if (!av && !bv) return 0;
      if (!av) return 1; // unset sorts last
      if (!bv) return -1;
      const cmp = av.localeCompare(bv);
      return f.sortDir === "desc" ? -cmp : cmp;
    });
  } else {
    sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  return sorted;
}

// Derive a URL slug from a project name (mirrors the server's slug rules).
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function AdminClient({
  initialTickets,
  initialProject,
  userEmail,
}: {
  initialTickets: Ticket[];
  initialProject?: string;
  userEmail: string;
}) {
  const { routes } = useNavigation();
  // The projects list is shared via ProjectsContext (sidebar + board), so a
  // created/renamed project shows everywhere instantly.
  const { projects: projectList, addProject, patchProject } = useProjects();
  // Full ticket list (source of truth). The board filters/sorts it client-side
  // into `tickets`, so switching project/owner/filter is an in-memory recompute.
  const [allTickets, setAllTickets] = useState<Ticket[]>(initialTickets);
  // One modal handles both creating and editing a project. `editingSlug` is null
  // in create mode, or the project's (original) slug when editing.
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [pmName, setPmName] = useState("");
  const [pmSlug, setPmSlug] = useState("");
  // While creating, the slug auto-follows the name until the user edits it.
  const [pmSlugEdited, setPmSlugEdited] = useState(false);
  const [pmGithub, setPmGithub] = useState("");
  const [pmLocal, setPmLocal] = useState("");
  const [pmOwners, setPmOwners] = useState("");
  const [pmSaving, setPmSaving] = useState(false);
  const [detectedRepos, setDetectedRepos] = useState<
    {
      name: string;
      path: string;
      status?: "ready" | "no-remote" | "not-a-repo";
      remote?: string | null;
      branch?: string | null;
    }[]
  >([]);
  const [rescanning, setRescanning] = useState(false);
  // One modal handles both creating and editing a ticket. `editingId` is null
  // in create mode, or the ticket id when editing.
  const [ticketModalOpen, setTicketModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // When a new ticket is started from a board column's "+", the column it should
  // land in. null = the default ("requested"). Only used on create.
  const [tmStatus, setTmStatus] = useState<TicketStatus | null>(null);
  const [tmProject, setTmProject] = useState("");
  const [tmBranch, setTmBranch] = useState("");
  const [tmBranches, setTmBranches] = useState<string[]>([]);
  const [tmBranchLoading, setTmBranchLoading] = useState(false);
  const [tmTitle, setTmTitle] = useState("");
  const [tmRequester, setTmRequester] = useState("");
  const [tmDescription, setTmDescription] = useState("");
  const [tmImages, setTmImages] = useState<string[]>([]); // already-uploaded URLs
  const [tmFiles, setTmFiles] = useState<File[]>([]); // new uploads
  const [tmSaving, setTmSaving] = useState(false);
  const [project, setProject] = useState(initialProject ?? ALL);
  const [owner, setOwner] = useState(ALL);
  const [loading, setLoading] = useState(false);
  // Named agent sessions — the assignee options beyond "Me".
  const {
    sessions: agentSessions,
    canDispatch,
    reload: reloadAgentSessions,
  } = useAgentSessions();
  // On mobile the filters/actions row is collapsed by default to save space;
  // the header's settings button (rendered in the dashboard layout) toggles it
  // via a window event. Always visible on md+ regardless of this flag.
  const [showControls, setShowControls] = useState(false);
  // One board-level chat sheet (not inside each card). Holds the id; the live
  // ticket is derived from `tickets` so the sheet sees Realtime updates.
  const [chatTicketId, setChatTicketId] = useState<string | null>(null);

  // Property/value system. Properties belong to one project, so these controls
  // only apply when a single project is selected.
  const [properties, setProperties] = useState<ProjectProperty[]>([]);
  const [showProperties, setShowProperties] = useState(false);
  const [sortProp, setSortProp] = useState(ALL); // ALL = newest first
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterProp, setFilterProp] = useState(ALL);
  const [filterValue, setFilterValue] = useState(ALL);

  const singleProject = project !== ALL;
  // Priority is shown inline on the card meta row (next to the requester); the
  // rest of the properties stay in the card body.
  const priorityProperty =
    properties.find((p) => p.name.toLowerCase() === "priority") ?? null;
  const otherProperties = properties.filter((p) => p !== priorityProperty);

  // "Summarize tickets" report state.
  const [showSummary, setShowSummary] = useState(false);
  const [sumFrom, setSumFrom] = useState("");
  const [sumTo, setSumTo] = useState("");
  const [sumProject, setSumProject] = useState(ALL);
  const [sumStatuses, setSumStatuses] = useState<TicketStatus[]>([]);
  const [sumText, setSumText] = useState("");
  const [sumLoading, setSumLoading] = useState(false);
  const [sumCount, setSumCount] = useState<number | null>(null);

  // Project property definitions drive the priority chip + property editors.
  // Cached per project for the life of the app (see lib/app-cache), so both
  // switching projects and returning to the board are instant.

  const [propertiesFor, setPropertiesFor] = useState(project);
  if (propertiesFor !== project) {
    // These properties belong to the project that is no longer showing; drop
    // them here rather than letting them linger until the fetch below answers.
    setPropertiesFor(project);
    setProperties([]);
  }
  useEffect(() => {
    if (!singleProject) return;
    // App-lifetime cache, not a ref: a ref died with the component, so every
    // return to the board re-fetched all of this — one request per project, each
    // a full round trip — for definitions that had not changed.
    // The cache is a browser-only store, so it cannot be read during render
    // without the server and the client disagreeing. Showing its answer at once
    // is the whole point of peeking.
    const cached = peekGet<{ properties?: ProjectProperty[] }>(propertiesUrl(project));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached) setProperties(cached.properties ?? []); // instant
    let cancelled = false;
    cachedGet<{ properties?: ProjectProperty[] }>(propertiesUrl(project))
      .then((d) => {
        if (!cancelled) setProperties(d.properties ?? []);
      })
      .catch(() => {
        if (!cancelled && !cached) setProperties([]);
      });
    return () => {
      cancelled = true;
    };
  }, [project, singleProject]);

  // Preload every project's property definitions once, so even the first switch
  // to a project renders priority/properties immediately (no fetch wait).
  useEffect(() => {
    for (const p of projectList) void cachedGet(propertiesUrl(p.slug)).catch(() => {});
  }, [projectList]);

  // Three things that follow something else, adjusted during render so they are
  // never a commit behind what they follow — a filter still showing the previous
  // project's property is a filter that is briefly wrong, not merely late.
  //
  // Switching project (or leaving single-project view) clears property
  // sort/filter; picking a new filter property resets its chosen value.
  const [sortFor, setSortFor] = useState(project);
  if (sortFor !== project) {
    setSortFor(project);
    setSortProp(ALL);
    setFilterProp(ALL);
    setFilterValue(ALL);
  }
  const [filterValueFor, setFilterValueFor] = useState(filterProp);
  if (filterValueFor !== filterProp) {
    setFilterValueFor(filterProp);
    setFilterValue(ALL);
  }
  // Sidebar project links are soft navigations: the server re-renders with a new
  // `initialProject` prop, but `project` was only seeded on mount. Follow it, or
  // clicking a project in the sidebar does not change the filter.
  const [projectFrom, setProjectFrom] = useState(initialProject);
  if (projectFrom !== initialProject) {
    setProjectFrom(initialProject);
    setProject(initialProject ?? ALL);
  }

  // Fetch the whole ticket list once (and on realtime). Filtering/sorting is
  // done client-side, so this does NOT depend on the active filters — changing
  // a filter never refetches.
  // Tickets are live data, so this always ends at the server — but it shows the
  // last list we had FIRST. Coming back to the board used to mean an empty board
  // until a fresh round trip finished; now it paints immediately and updates in
  // place. `refreshGet` also collapses the duplicate calls a remount fires.
  const load = useCallback(async (force = false) => {
    const cached = peekGet<{ tickets?: Ticket[] }>(TICKETS_URL);
    if (cached) setAllTickets(cached.tickets ?? []);
    else setLoading(true);
    try {
      const data = await refreshGet<{ tickets?: Ticket[] }>(
        TICKETS_URL,
        force ? 0 : TICKETS_DEDUPE_MS
      );
      setAllTickets(data.tickets ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred by a microtask so the first paint is not blocked by a synchronous
    // state write while effects are still flushing; `load` is asynchronous from
    // here on anyway.
    void Promise.resolve().then(() => load());
  }, [load]);

  // Mirror the board you can see into the cache, so returning to it shows that
  // board — including the edits, dispatches and deletes applied locally since
  // the last fetch. One place, rather than an invalidation in each of the ten
  // handlers that touch the list.
  const listLoaded = useRef(false);
  useEffect(() => {
    if (listLoaded.current) primeCache(TICKETS_URL, { tickets: allTickets });
    else if (allTickets.length) listLoaded.current = true;
  }, [allTickets]);

  // The visible board: filter + sort the full list client-side, mirroring the
  // server's semantics (project/owner/property-value filter; property sort with
  // unset values last, otherwise newest-first). Pure recompute — no fetch.
  const tickets = useMemo(
    () =>
      filterAndSortTickets(allTickets, {
        project,
        owner,
        filterProp,
        filterValue,
        sortProp,
        sortDir,
      }),
    [allTickets, project, owner, filterProp, filterValue, sortProp, sortDir]
  );

  // Switching projects from the sidebar while already on the board is handled
  // client-side (no server navigation): just change the filter and update the
  // URL in place. Avoids the blocking server re-render + double fetch.
  useEffect(() => {
    const handler = (e: Event) => {
      const slug = (e as CustomEvent<{ slug: string }>).detail?.slug;
      if (slug === undefined) return;
      setProject(slug || ALL);
      window.history.replaceState(
        null,
        "",
        routes.board(slug || undefined)
      );
    };
    window.addEventListener("select-project", handler);
    return () => window.removeEventListener("select-project", handler);
  }, []);

  // Deep link: /dashboard?ticket=<id> opens that ticket's dialog. Work-log
  // ticket chips link here. The board loads every ticket, so we just open it
  // once it appears in the list (this re-runs as `allTickets` fills in).
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (deepLinkedRef.current) return;
    const id = new URLSearchParams(window.location.search).get("ticket");
    if (!id) return;
    const found = allTickets.find((t) => t.id === id);
    if (!found) return;
    deepLinkedRef.current = true;
    openEditTicket(found);
    // openEditTicket is a stable in-component fn; only re-run as tickets load.
  }, [allTickets]);

  // Live updates via Supabase Realtime — replaces polling. Any change to the
  // tickets table (worker progress, new tickets, the staleness sweep) reloads
  // the board, respecting the current filters. Subscribe once; always call the
  // latest `load` via a ref.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("admin-tickets")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets" },
        () => loadRef.current()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // The "New project" button now lives in the sidebar; it opens this modal via
  // a window event (the modal + project state stay here on the board).
  // Open the project modal in create (project=null) or edit mode (prefilled).
  const openProjectModal = useCallback((p: Project | null) => {
    setEditingSlug(p?.slug ?? null);
    setPmName(p?.name ?? "");
    setPmSlug(p?.slug ?? "");
    // Editing starts with an existing slug (don't auto-rewrite it); creating
    // starts clean so the slug follows the name.
    setPmSlugEdited(p != null);
    setPmGithub(p?.github_repo ?? "");
    setPmLocal(p?.local_path ?? "");
    setPmOwners((p?.owners ?? []).join(", "));
    setProjectModalOpen(true);
  }, []);

  useEffect(() => {
    const handler = () => openProjectModal(null);
    window.addEventListener("new-project", handler);
    return () => window.removeEventListener("new-project", handler);
  }, [openProjectModal]);

  // The mobile header's settings button toggles the filters/actions row.
  useEffect(() => {
    const handler = () => setShowControls((v) => !v);
    window.addEventListener("toggle-board-controls", handler);
    return () => window.removeEventListener("toggle-board-controls", handler);
  }, []);

  // The sidebar's per-project edit button opens this modal via a window event,
  // carrying the slug. Look the full project up from our list and prefill.
  useEffect(() => {
    const handler = (e: Event) => {
      const slug = (e as CustomEvent<{ slug: string }>).detail?.slug;
      const found = projectList.find((p) => p.slug === slug);
      if (found) openProjectModal(found);
    };
    window.addEventListener("edit-project", handler);
    return () => window.removeEventListener("edit-project", handler);
  }, [projectList, openProjectModal]);

  // Read the worker's last-reported set of local repos for the path picker.
  const loadRepos = useCallback(() => {
    return fetch("/api/v1/repos")
      .then((r) => r.json())
      .then((d) => setDetectedRepos(d.repos ?? []))
      .catch(() => {});
  }, []);

  // While the project modal is open, load the discovered repos to pick from.
  useEffect(() => {
    if (!projectModalOpen) return;
    void loadRepos();
  }, [projectModalOpen, loadRepos]);

  // "Rescan paths": ask the worker to re-scan now, then poll for the fresh set.
  // The worker takes the request on its next idle poll (~3s) and reports back.
  async function rescanRepos() {
    setRescanning(true);
    try {
      // No worker means nothing will pick up the request — say so instead of
      // polling for a result that can't arrive.
      const presence: { connected?: boolean } | null = await fetch(
        "/api/v1/worker"
      )
        .then((r) => r.json())
        .catch(() => null);
      if (!presence?.connected) {
        toast.error("Worker offline — start the worker to scan paths");
        return;
      }
      await fetch("/api/v1/repos", { method: "POST" });
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await loadRepos();
      }
      toast.success("Rescanned local paths");
    } catch {
      toast.error("Rescan failed");
    } finally {
      setRescanning(false);
    }
  }

  // When the ticket modal is open, load the chosen project's branches as
  // suggestions. The field is free-entry: a typed branch that doesn't exist is
  // created off main by the worker, so we don't force a default value.
  const [branchesFor, setBranchesFor] = useState<string | null>(null);
  const branchKey = ticketModalOpen && tmProject ? tmProject : null;
  if (branchesFor !== branchKey) {
    setBranchesFor(branchKey);
    setTmBranches([]);
  }
  useEffect(() => {
    if (!ticketModalOpen || !tmProject) return;
    let cancelled = false;
    void Promise.resolve().then(() => setTmBranchLoading(true));
    fetch(`/api/admin/projects/${tmProject}/branches`)
      .then((r) => r.json())
      .then((d: { branches?: string[] }) => {
        if (!cancelled) setTmBranches(d.branches ?? []);
      })
      .catch(() => {
        if (!cancelled) setTmBranches([]);
      })
      .finally(() => !cancelled && setTmBranchLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ticketModalOpen, tmProject]);


  async function patch(
    id: string,
    body: Partial<Ticket> & { ownerKind?: OwnerKind; agentSessionId?: string | null }
  ) {
    const res = await fetch(`/api/v1/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      toast.error("Update failed");
      return;
    }
    const { ticket } = await res.json();
    setAllTickets((prev) => prev.map((t) => (t.id === id ? ticket : t)));
    toast.success("Updated");
  }

  async function remove(id: string) {
    if (!confirm("Delete this ticket?")) return;
    const res = await fetch(`/api/v1/tickets/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    setAllTickets((prev) => prev.filter((t) => t.id !== id));
    toast.success("Deleted");
  }

  async function dispatch(id: string) {
    const res = await fetch(`/api/v1/tickets/${id}/dispatch`, {
      method: "POST",
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      toast.error(error ?? "Failed to start Claude Code");
      return;
    }
    // Only reflect the queued run; the ticket's status/column is left as-is
    // (Markbase moves it manually).
    setAllTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, cc_state: "queued" } : t))
    );
    // The job is queued either way — a worker that starts later claims it. But
    // "the local worker will pick it up" is a promise nothing keeps when no
    // worker is running, and the job then sits there looking dispatched. Say
    // which of the two actually happened.
    const presence: { connected?: boolean } | null = await fetch(
      "/api/v1/worker"
    )
      .then((r) => r.json())
      .catch(() => null);
    if (presence && !presence.connected) {
      toast.warning("Queued, but no worker is running — start it to run this");
      return;
    }
    toast.success("Queued — the local worker will pick it up");
  }

  async function cancelRun(id: string) {
    const res = await fetch(`/api/v1/tickets/${id}/cancel`, {
      method: "POST",
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      toast.error(error ?? "Failed to cancel");
      return;
    }
    setAllTickets((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, cc_state: "idle", status: "requested" } : t
      )
    );
    toast.success("Run canceled"); // board also updates live via Realtime
  }

  async function fetchPreview(id: string) {
    const res = await fetch(`/api/v1/tickets/${id}/preview`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "No preview available yet");
      return;
    }
    setAllTickets((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, preview_url: data.preview_url } : t
      )
    );
    toast.success("Preview URL found");
  }

  async function syncReview(id: string) {
    const res = await fetch(`/api/v1/tickets/${id}/review`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Could not check review status");
      return;
    }
    if (data.review_requested) {
      setAllTickets((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, status: "review_requested" } : t
        )
      );
      toast.success("Review requested — status updated");
    } else {
      toast.info("No review requested on the PR yet");
    }
  }

  async function saveProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = {
      name: pmName,
      slug: pmSlug,
      github_repo: pmGithub,
      local_path: pmLocal,
      owners: cleanNameList(pmOwners),
    };
    setPmSaving(true);
    const res = editingSlug
      ? await fetch(`/api/admin/projects/${editingSlug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/admin/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setPmSaving(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      toast.error(error ?? (editingSlug ? "Failed to update project" : "Failed to create project"));
      return;
    }
    const { project: saved } = await res.json();
    // Optimistically update the shared list — sidebar + board reflect it now.
    if (editingSlug) patchProject(editingSlug, saved);
    else addProject(saved);
    // If we were filtering by a renamed project, follow the new slug.
    if (editingSlug && project === editingSlug && saved.slug !== editingSlug) {
      setProject(saved.slug);
    }
    setProjectModalOpen(false);
    toast.success(`Project "${saved.name}" ${editingSlug ? "updated" : "created"}`);
    load();
  }

  // Shared reset before opening the ticket modal in either mode.
  function resetTicketForm() {
    setTmTitle("");
    setTmRequester("");
    setTmDescription("");
    setTmBranch("");
    setTmImages([]);
    setTmFiles([]);
  }

  function openCreateTicket(initialStatus?: TicketStatus) {
    resetTicketForm();
    // The owner is the requester for tickets opened here; new tickets default to
    // "Me" (no agent) — assign an agent session later from the card.
    setTmRequester(userEmail);
    setEditingId(null);
    setTmStatus(initialStatus ?? null);
    setTmProject(project !== ALL ? project : projectList[0]?.slug ?? "");
    setTicketModalOpen(true);
  }

  function openEditTicket(t: Ticket) {
    setEditingId(t.id);
    setTmStatus(null);
    setTmProject(t.project);
    setTmBranch(t.base_branch ?? "");
    setTmTitle(t.title);
    setTmRequester(t.requester);
    setTmDescription(t.description);
    setTmImages(t.images ?? []);
    setTmFiles([]);
    setTicketModalOpen(true);
  }

  async function saveTicket(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const slug = tmProject;
    if (!slug) {
      toast.error("Pick a project");
      return;
    }

    setTmSaving(true);
    let newUrls: string[] = [];
    try {
      newUrls = await uploadImages(tmFiles, slug);
    } catch {
      setTmSaving(false);
      toast.error("Image upload failed");
      return;
    }

    // New tickets are assigned to the user (no agent session); assign an agent
    // from the ticket card afterwards.
    const payload = {
      title: tmTitle.trim(),
      requester: tmRequester.trim(),
      description: tmDescription.trim(),
      images: [...tmImages, ...newUrls],
      base_branch: tmBranch.trim() || (editingId ? null : undefined),
    };

    const res = editingId
      ? await fetch(`/api/v1/tickets/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch(`/api/projects/${slug}/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setTmSaving(false);
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Failed" }));
      toast.error(error ?? (editingId ? "Failed to save" : "Failed to add ticket"));
      return;
    }

    if (editingId) {
      const { ticket } = await res.json();
      setAllTickets((prev) => prev.map((t) => (t.id === ticket.id ? ticket : t)));
      toast.success("Ticket updated");
    } else {
      // Optimistic: show the new ticket immediately instead of waiting for the
      // realtime echo. The realtime reload reconciles (dedupe by id meanwhile).
      const { ticket } = await res.json().catch(() => ({ ticket: null }));
      if (ticket) {
        // The intake endpoint always creates "requested"; if this was started
        // from another column's "+", move it there (admin PATCH, like a drag).
        const target = tmStatus && tmStatus !== "requested" ? tmStatus : null;
        const placed = target ? { ...ticket, status: target } : ticket;
        setAllTickets((prev) =>
          prev.some((t) => t.id === placed.id) ? prev : [placed, ...prev]
        );
        if (target) {
          fetch(`/api/v1/tickets/${ticket.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: target }),
          }).catch(() => {});
        }
      }
      toast.success("Ticket added");
    }
    setTicketModalOpen(false);
  }

  // Values offered in the "Value" filter: a property's fixed options, plus any
  // values actually present on tickets (so free-text fields are filterable too).
  const filterValueOptions = (() => {
    if (filterProp === ALL) return [];
    const found = new Set<string>();
    const prop = properties.find((p) => p.id === filterProp);
    for (const o of prop?.options ?? []) found.add(o);
    for (const t of tickets) {
      const v = t.properties?.[filterProp];
      if (v) found.add(v);
    }
    return Array.from(found).sort((a, b) => a.localeCompare(b));
  })();

  function openSummary() {
    // Default to the last 30 days, honoring the board's current project filter.
    const today = new Date();
    const past = new Date(today);
    past.setDate(past.getDate() - 30);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    setSumFrom(iso(past));
    setSumTo(iso(today));
    setSumProject(project);
    setSumStatuses(["review_requested", "done"]);
    setSumText("");
    setSumCount(null);
    setShowSummary(true);
  }

  function toggleSumStatus(s: TicketStatus) {
    setSumStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  async function generateSummary() {
    if (!sumFrom || !sumTo) {
      toast.error("Pick a date range");
      return;
    }
    if (sumStatuses.length === 0) {
      toast.error("Pick at least one status");
      return;
    }
    setSumLoading(true);
    try {
      const res = await fetch("/api/v1/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: sumFrom,
          to: sumTo,
          statuses: sumStatuses,
          project: sumProject === ALL ? undefined : sumProject,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(error ?? "Failed to generate summary");
        return;
      }
      const { summary, count } = await res.json();
      setSumText(summary ?? "");
      setSumCount(count ?? 0);
      if (count === 0) toast.info("No tickets were marked done in that period");
    } finally {
      setSumLoading(false);
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(sumText);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  function downloadSummary() {
    const blob = new Blob([sumText], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets-summary-${sumFrom}_to_${sumTo}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Kanban: one column per status. Dragging a ticket to another column patches
  // its status. In-column reordering isn't persisted (tickets have no position).
  const statusColumns: KanbanColumn[] = TICKET_STATUSES.map((s) => {
    const count = tickets.filter((t) => t.status === s).length;
    return {
      id: s,
      emptyLabel: "No tickets.",
      header: (
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              STATUS_STYLES[s]
            )}
          >
            {STATUS_LABELS[s]}
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openCreateTicket(s);
            }}
            disabled={projectList.length === 0}
            aria-label={`New ticket in ${STATUS_LABELS[s]}`}
            title={`New ticket in ${STATUS_LABELS[s]}`}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      ),
    };
  });

  function onTicketDrag(change: KanbanChange) {
    if (change.moved) patch(change.itemId, { status: change.to as TicketStatus });
  }

  // Keep interactions with a card's controls from starting a drag (pointerdown)
  // or bubbling up to the card's open-editor click.
  const stopDrag = (e: React.SyntheticEvent) => e.stopPropagation();

  // Live ticket for the board-level chat sheet (reflects Realtime updates).
  const chatTicket = chatTicketId
    ? tickets.find((t) => t.id === chatTicketId) ?? null
    : null;

  function renderTicketCard(t: Ticket) {
    return (
      <Card
        className="cursor-pointer gap-0 overflow-hidden py-0"
        onClick={() => openEditTicket(t)}
      >
        <CardHeader className="gap-2 space-y-0 p-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm leading-snug break-words">
              {t.title}
            </CardTitle>
            <div
              className="flex shrink-0 items-center"
              onPointerDown={stopDrag} onClick={stopDrag}
            >
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => openEditTicket(t)}
                aria-label="Edit ticket"
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => remove(t.id)}
                aria-label="Delete ticket"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>by {t.requester}</span>
            {priorityProperty && (
              <div className="w-[88px]" onPointerDown={stopDrag} onClick={stopDrag}>
                <PropertyValueEditor
                  ticket={t}
                  property={priorityProperty}
                  compact
                  valueColors={PRIORITY_VALUE_COLORS}
                  onSaved={(updated) =>
                    setAllTickets((prev) =>
                      prev.map((x) => (x.id === updated.id ? updated : x))
                    )
                  }
                />
              </div>
            )}
            {t.cc_state === "running" && (
              <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                Running
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-2 px-3 pb-3">
          <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {t.description}
          </p>
          {t.images?.length > 0 && (
            <div className="flex flex-wrap gap-1.5" onPointerDown={stopDrag} onClick={stopDrag}>
              {t.images.map((url, i) => (
                <AttachmentThumb key={i} url={url} className="size-12" />
              ))}
            </div>
          )}
          {singleProject && otherProperties.length > 0 && (
            <div className="flex flex-wrap gap-1.5" onPointerDown={stopDrag} onClick={stopDrag}>
              {otherProperties.map((p) => (
                <div key={p.id} className="w-[120px]">
                  <PropertyValueEditor
                    ticket={t}
                    property={p}
                    onSaved={(updated) =>
                      setAllTickets((prev) =>
                        prev.map((x) => (x.id === updated.id ? updated : x))
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter
          className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t bg-muted/30 p-3"
          onPointerDown={stopDrag} onClick={stopDrag}
        >
          <div className="w-[170px]">
            <AssigneePicker
              ticket={t}
              sessions={agentSessions}
              canDispatch={canDispatch}
              onAssign={(a) => patch(t.id, a)}
              onCreated={reloadAgentSessions}
            />
          </div>
          {t.owner_kind === "agent" && (
            <ClaudeCodeControl
              ticket={t}
              onRun={() => dispatch(t.id)}
              onPreview={() => fetchPreview(t.id)}
              onSyncReview={() => syncReview(t.id)}
              onCancel={() => cancelRun(t.id)}
            />
          )}
          {t.cc_session_id && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-8 px-2.5 text-xs"
              onClick={() => setChatTicketId(t.id)}
            >
              <MessageSquare className="size-3.5" />
              {t.cc_state === "queued" || t.cc_state === "running"
                ? "View live session"
                : "Chat / follow up"}
            </Button>
          )}
        </CardFooter>
      </Card>
    );
  }

  return (
    <main className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="Projects" />
      <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
      {/* Per-project asset tabs (Board · Secrets · Work Logs), shown only when a
          single project is selected. */}
      {singleProject && (
        <div className="mb-3 shrink-0">
          <ProjectTabs
            slug={project}
            active="board"
            projectName={projectList.find((p) => p.slug === project)?.name}
          />
        </div>
      )}

      {/* Header: filters on the left, actions on the right. Collapsed on mobile
          (toggled by the header's settings button); always shown on md+. */}
      <div
        className={cn(
          "mb-3 shrink-0 flex-wrap items-end justify-between gap-3 md:flex",
          showControls ? "flex" : "hidden"
        )}
      >

        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Project"
            value={project}
            onChange={setProject}
            options={[
              { value: ALL, label: "All projects" },
              ...projectList.map((p) => ({ value: p.slug, label: p.name })),
            ]}
          />
          <FilterSelect
            label="Assignee"
            value={owner}
            onChange={setOwner}
            options={[
              { value: ALL, label: "All assignees" },
              ...ownerOptions(agentSessions),
            ]}
          />

          {/* Property sort + filter — only meaningful within a single project. */}
          {singleProject && properties.length > 0 && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Sort by
                </span>
                <div className="flex gap-1.5">
                  <Select value={sortProp} onValueChange={setSortProp}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Newest</SelectItem>
                      {properties.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sortProp !== ALL && (
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() =>
                        setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                      }
                      aria-label="Toggle sort direction"
                      title={sortDir === "asc" ? "Ascending" : "Descending"}
                    >
                      {sortDir === "asc" ? (
                        <ArrowDownAZ className="size-4" />
                      ) : (
                        <ArrowUpAZ className="size-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>

              <FilterSelect
                label="Property"
                value={filterProp}
                onChange={setFilterProp}
                options={[
                  { value: ALL, label: "Any property" },
                  ...properties.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />

              {filterProp !== ALL && (
                <FilterSelect
                  label="Value"
                  value={filterValue}
                  onChange={setFilterValue}
                  options={[
                    { value: ALL, label: "Any value" },
                    ...filterValueOptions.map((v) => ({ value: v, label: v })),
                  ]}
                />
              )}
            </>
          )}
        </div>

        <div className="flex gap-2">
          {singleProject && (
            <Button variant="outline" onClick={() => setShowProperties(true)}>
              <Settings2 className="size-4" />
              Properties
            </Button>
          )}
          <Button variant="outline" onClick={openSummary}>
            <FileText className="size-4" />
            Summarize
          </Button>
          <Button
            onClick={() => openCreateTicket()}
            disabled={projectList.length === 0}
          >
            <Plus className="size-4" />
            New ticket
          </Button>
        </div>
      </div>

      {singleProject && (
        <ManagePropertiesDialog
          project={project}
          open={showProperties}
          onOpenChange={setShowProperties}
          properties={properties}
          onChange={setProperties}
        />
      )}

      {/* Create / edit project modal (same form for both) */}
      <Dialog open={projectModalOpen} onOpenChange={setProjectModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSlug ? "Edit project" : "New project"}
            </DialogTitle>
            <DialogDescription>
              Point the project at a local repo or worktree the worker runs in;
              the GitHub link is optional.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveProject} className="min-w-0 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pm-name">Name</Label>
                <Input
                  id="pm-name"
                  value={pmName}
                  onChange={(e) => {
                    setPmName(e.target.value);
                    if (!pmSlugEdited) setPmSlug(slugify(e.target.value));
                  }}
                  required
                  placeholder="CBA"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pm-slug">Slug (URL)</Label>
                <Input
                  id="pm-slug"
                  value={pmSlug}
                  onChange={(e) => {
                    setPmSlugEdited(true);
                    setPmSlug(e.target.value);
                  }}
                  required
                  placeholder="cba"
                />
              </div>
            </div>

            {detectedRepos.length > 0 && (
              <div className="space-y-2">
                <Label>Pick a repo Claude has worked in</Label>
                <Select value={pmLocal} onValueChange={setPmLocal}>
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Choose a discovered repo or folder…" />
                  </SelectTrigger>
                  <SelectContent className="max-w-(--radix-select-trigger-width)">
                    {detectedRepos.map((r) => (
                      <SelectItem key={r.path} value={r.path}>
                        <span className="flex min-w-0 items-center gap-2">
                          {r.status === "ready" ? (
                            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">{r.name}</span>
                          {r.status && r.status !== "ready" && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {r.status === "no-remote" ? "local git" : "no git"}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="pm-local">Local repo path</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={rescanRepos}
                  disabled={rescanning}
                  className="h-7 gap-1.5 text-xs"
                >
                  {rescanning ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Rescan paths
                </Button>
              </div>
              <Input
                id="pm-local"
                value={pmLocal}
                onChange={(e) => setPmLocal(e.target.value)}
                required
                placeholder="/Users/you/Repo/project"
              />
              <p className="text-xs text-muted-foreground">
                Pick a discovered repo above, or type an absolute path. Rescan
                asks your worker to re-scan Claude&apos;s recent project folders.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pm-github">GitHub repo link (optional)</Label>
              <Input
                id="pm-github"
                value={pmGithub}
                onChange={(e) => setPmGithub(e.target.value)}
                placeholder="owner/repo or https://github.com/owner/repo"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to read it from the repo&apos;s origin remote.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pm-owners">Assignee (optional)</Label>
              <Input
                id="pm-owners"
                value={pmOwners}
                onChange={(e) => setPmOwners(e.target.value)}
                placeholder="Markbase, Alex, Sam"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated names of the people assigned to this project.
              </p>
            </div>

            <Button type="submit" disabled={pmSaving} className="w-full">
              {pmSaving
                ? editingSlug
                  ? "Saving…"
                  : "Creating…"
                : editingSlug
                  ? "Save changes"
                  : "Create project"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Board-level chat sheet (one instance, not inside each card) */}
      <TicketChat
        ticket={chatTicket}
        onClose={() => setChatTicketId(null)}
        onRefresh={load}
      />

      {/* Create / edit ticket modal (same form for both). Full screen on mobile,
          a centered dialog on sm+. */}
      <Dialog open={ticketModalOpen} onOpenChange={setTicketModalOpen}>
        <DialogContent className="max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit ticket" : "New ticket"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the request details, branch, and attachments."
                : "Add a request. Include the resources required in the description."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveTicket} className="min-w-0 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Project</Label>
                <Select
                  value={tmProject}
                  onValueChange={setTmProject}
                  disabled={!!editingId}
                >
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue placeholder="Choose a project…" />
                  </SelectTrigger>
                  <SelectContent>
                    {projectList.map((p) => (
                      <SelectItem key={p.slug} value={p.slug}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tm-branch">Branch</Label>
                <Input
                  id="tm-branch"
                  list="tm-branch-options"
                  value={tmBranch}
                  onChange={(e) => setTmBranch(e.target.value)}
                  placeholder={tmBranchLoading ? "Loading branches…" : "auto"}
                  autoComplete="off"
                />
                <datalist id="tm-branch-options">
                  {tmBranches.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  Pick an existing branch or type a new name — a new branch is
                  created off main.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tm-title">Title</Label>
              <Input
                id="tm-title"
                required
                value={tmTitle}
                onChange={(e) => setTmTitle(e.target.value)}
                placeholder="Short summary of the request"
              />
            </div>
            {/* On create the requester is the signed-in owner — don't ask. It's
                still editable afterwards (a ticket may come from a customer). */}
            {editingId && (
              <div className="space-y-2">
                <Label htmlFor="tm-requester">Requester</Label>
                <Input
                  id="tm-requester"
                  required
                  value={tmRequester}
                  onChange={(e) => setTmRequester(e.target.value)}
                  placeholder="Who is requesting this?"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="tm-description">Description</Label>
              <Textarea
                id="tm-description"
                required
                rows={5}
                value={tmDescription}
                onChange={(e) => setTmDescription(e.target.value)}
                placeholder="What needs to be done, and what resources are required to complete it (data, access, budget, people, tools)?"
              />
            </div>
            <div className="space-y-2">
              {tmImages.length > 0 && (
                <>
                  <Label>Current attachments</Label>
                  <div className="flex flex-wrap gap-2">
                    {tmImages.map((url, i) => (
                      <AttachmentThumb
                        key={url}
                        url={url}
                        onRemove={() =>
                          setTmImages((prev) => prev.filter((_, idx) => idx !== i))
                        }
                      />
                    ))}
                  </div>
                </>
              )}
              <ImageUpload
                id="tm-images"
                label={tmImages.length ? "Add attachments" : "Screenshots or PDFs (optional)"}
                files={tmFiles}
                onFilesChange={setTmFiles}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={tmSaving} className="w-full">
                {tmSaving
                  ? editingId
                    ? "Saving…"
                    : "Adding…"
                  : editingId
                    ? "Save changes"
                    : "Submit request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Summarize done tickets modal */}
      <Dialog open={showSummary} onOpenChange={setShowSummary}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Summarize completed tickets</DialogTitle>
            <DialogDescription>
              Generate an editable markdown report of tickets marked done in a
              period.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="sum-from">From</Label>
                <Input
                  id="sum-from"
                  type="date"
                  value={sumFrom}
                  max={sumTo || undefined}
                  onChange={(e) => setSumFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sum-to">To</Label>
                <Input
                  id="sum-to"
                  type="date"
                  value={sumTo}
                  min={sumFrom || undefined}
                  onChange={(e) => setSumTo(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Select value={sumProject} onValueChange={setSumProject}>
                  <SelectTrigger className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All projects</SelectItem>
                    {projectList.map((p) => (
                      <SelectItem key={p.slug} value={p.slug}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Statuses</Label>
              <div className="flex flex-wrap gap-2">
                {TICKET_STATUSES.map((s) => {
                  const on = sumStatuses.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSumStatus(s)}
                      aria-pressed={on}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        on
                          ? cn("border-transparent", STATUS_STYLES[s])
                          : "border-input text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {STATUS_LABELS[s]}
                    </button>
                  );
                })}
              </div>
            </div>

            <Button onClick={generateSummary} disabled={sumLoading} className="w-full">
              {sumLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <FileText className="size-4" />
                  {sumText ? "Regenerate" : "Generate summary"}
                </>
              )}
            </Button>

            {sumText && (
              <>
                <MarkdownEditor
                  value={sumText}
                  onChange={setSumText}
                  placeholder="Your summary…"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {sumCount ?? 0} ticket(s)
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={copySummary}>
                      <Copy className="size-4" />
                      Copy
                    </Button>
                    <Button variant="outline" size="sm" onClick={downloadSummary}>
                      <Download className="size-4" />
                      Download .md
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {tickets.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border text-sm text-muted-foreground">
          {loading ? "Loading…" : "No tickets match these filters."}
        </div>
      ) : (
        <Kanban
          columns={statusColumns}
          items={tickets}
          getColumnId={(t) => t.status}
          onChange={onTicketDrag}
          renderCard={renderTicketCard}
          className="rounded-xl bg-muted/40 p-3"
          columnClassName="shadow-sm"
        />
      )}
      </div>
    </main>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const CC_STATE_CHIP: Record<string, { label: string; className: string }> = {
  done: { label: "Done", className: "text-green-600 dark:text-green-400" },
  error: { label: "Failed", className: "text-destructive" },
};

function ClaudeCodeControl({
  ticket,
  onRun,
  onPreview,
  onSyncReview,
  onCancel,
}: {
  ticket: Ticket;
  onRun: () => void;
  onPreview: () => Promise<void>;
  onSyncReview: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const queued = ticket.cc_state === "queued";
  const running = ticket.cc_state === "running";
  const pending = queued || running;
  const chip = CC_STATE_CHIP[ticket.cc_state];

  async function handlePreview() {
    setPreviewLoading(true);
    await onPreview();
    setPreviewLoading(false);
  }

  async function handleSyncReview() {
    setReviewLoading(true);
    await onSyncReview();
    setReviewLoading(false);
  }

  async function handleCancel() {
    setCanceling(true);
    await onCancel();
    setCanceling(false);
  }

  // Renders inline chips that flow within the card footer's flex row.
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={pending}
        onClick={onRun}
        title={ticket.cc_summary ?? undefined}
      >
        {pending ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            {queued ? "Queued…" : "Running…"}
          </>
        ) : (
          <>
            <Bot className="size-3.5" />
            {ticket.cc_state === "idle" ? "Run" : "Run again"}
          </>
        )}
      </Button>

      {pending && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-muted-foreground hover:text-destructive"
          disabled={canceling}
          onClick={handleCancel}
          title={queued ? "Remove from the queue" : "Stop the running session"}
        >
          {canceling ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Square className="size-3.5" />
          )}
          {queued ? "Unqueue" : "Stop"}
        </Button>
      )}

      {!pending && chip && (
        <span className={`text-xs font-medium ${chip.className}`}>
          {chip.label}
        </span>
      )}

      {ticket.pr_url && (
        <a
          href={ticket.pr_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
        >
          <GitPullRequest className="size-3.5 text-purple-600" />
          PR #{ticket.pr_id ?? ""}
          {ticket.commits?.length ? ` · ${ticket.commits.length} commits` : ""}
        </a>
      )}

      {ticket.preview_url ? (
        <a
          href={ticket.preview_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-foreground hover:underline"
        >
          <Globe className="size-3.5 text-blue-600" />
          Preview
        </a>
      ) : ticket.pr_url ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={previewLoading}
          onClick={handlePreview}
        >
          {previewLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Globe className="size-3.5" />
          )}
          Get preview
        </Button>
      ) : null}

      {ticket.pr_url && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={reviewLoading}
          onClick={handleSyncReview}
          title="Check GitHub for a review request on the PR"
        >
          {reviewLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Eye className="size-3.5" />
          )}
          Sync review
        </Button>
      )}
    </>
  );
}
