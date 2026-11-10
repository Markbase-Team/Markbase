import { supabase } from "./supabase";
import {
  cleanNameList,
  isOwnerKind,
  isStatus,
  type CcState,
  type McpConfig,
  type OwnerKind,
  type Project,
  type ProjectProperty,
  type Ticket,
  type TicketCommit,
  type TicketStatus,
} from "./types";

// A JSONB key holding a per-ticket property value. Property ids are uuids;
// validating the shape keeps untrusted input out of order/filter path strings.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPropertyId(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Tickets that describe a defect get a `fix/` branch; everything else `feature/`.
const FIX_RE =
  /\b(fix|fixe[sd]|bug|bugs|broken|break(s|ing)?|error|errors|crash|crashe[sd]|regression|fail(s|ed|ing)?|incorrect|wrong|issue|issues|defect|hotfix|patch|typo)\b/i;

export function ticketBranchKind(
  ticket: Pick<Ticket, "title" | "description">
): "fix" | "feature" {
  return FIX_RE.test(`${ticket.title} ${ticket.description}`) ? "fix" : "feature";
}

// A kebab-case slug of the title, capped so branch names stay readable.
function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "ticket";
}

// The git branch a ticket's work belongs on. An explicit `base_branch` wins;
// otherwise a fresh, ticket-aligned branch — `feature/<slug>` or `fix/<slug>` —
// that the worker creates off main. A short id suffix keeps it unique and stable
// across re-runs even when two tickets share a title, so each ticket gets its
// own clean branch/PR instead of piling onto a shared long-running branch.
export function ticketBranch(
  ticket: Pick<Ticket, "id" | "title" | "description" | "base_branch">
): string {
  const explicit = ticket.base_branch?.trim();
  if (explicit) return explicit;
  return `${ticketBranchKind(ticket)}/${slugifyTitle(ticket.title)}-${ticket.id.slice(0, 6)}`;
}

// Keep only valid id→string entries; drop blanks so an unset value is "missing"
// in the JSONB map (which sorts/filters as null) rather than an empty string.
function sanitizeProperties(
  input: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isPropertyId(key) && typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

// All data access is scoped to a single owner (the signed-in user's id, or an
// API key's owner). Reads filter by owner_id; writes set it (root rows) or are
// guarded by it (so one user can't mutate another's rows). Child rows
// (tickets/jobs/work_logs/properties) get owner_id from a DB trigger on insert.
export async function listProjects(ownerId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("owner_id", ownerId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function getProject(
  slug: string,
  ownerId: string
): Promise<Project | undefined> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Project | undefined;
}

export interface CreateProjectInput {
  slug: string;
  name: string;
  local_path: string;
  github_repo: string | null;
  owners?: string[];
  /** The auth user who owns this project. */
  owner_id: string;
}

// Properties seeded onto every new project so they're present by default, the
// way `status` is a built-in field on every ticket. The
// 20260604_default_priority_property migration backfills the same set onto
// projects that predate this.
export const DEFAULT_PROJECT_PROPERTIES: ReadonlyArray<{
  name: string;
  options: string[];
}> = [{ name: "Priority", options: ["Low", "Medium", "High"] }];

export async function createProject(
  input: CreateProjectInput
): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      slug: input.slug,
      name: input.name,
      local_path: input.local_path,
      github_repo: input.github_repo,
      owners: cleanNameList(input.owners),
      owner_id: input.owner_id,
    })
    .select("*")
    .single();
  if (error) throw error;
  const project = data as Project;

  // Seed the default properties (e.g. Priority). Best-effort: a failure here
  // shouldn't fail project creation — the property can be re-added by hand.
  try {
    await Promise.all(
      DEFAULT_PROJECT_PROPERTIES.map((p, i) =>
        createProjectProperty({
          project: project.slug,
          name: p.name,
          options: p.options,
          position: i,
        })
      )
    );
  } catch {
    // Ignore — project is created; properties are non-critical to seed here.
  }

  return project;
}

export interface UpdateProjectInput {
  /** New slug (rename). tickets.project cascades on update. */
  slug?: string;
  name?: string;
  github_repo?: string | null;
  local_path?: string | null;
  owners?: string[];
  /** Per-project MCP servers (null clears it). */
  mcp_config?: McpConfig | null;
}

export async function updateProject(
  slug: string,
  input: UpdateProjectInput,
  ownerId: string
): Promise<Project | undefined> {
  const patch: {
    slug?: string;
    name?: string;
    github_repo?: string | null;
    local_path?: string | null;
    owners?: string[];
    mcp_config?: McpConfig | null;
  } = {};
  if (typeof input.slug === "string") patch.slug = input.slug;
  if (typeof input.name === "string") patch.name = input.name;
  if (input.github_repo !== undefined) patch.github_repo = input.github_repo;
  if (input.local_path !== undefined) patch.local_path = input.local_path;
  if (input.owners !== undefined) patch.owners = cleanNameList(input.owners);
  if (input.mcp_config !== undefined) patch.mcp_config = input.mcp_config;

  if (Object.keys(patch).length === 0) return getProject(slug, ownerId);

  const { data, error } = await supabase
    .from("projects")
    .update(patch)
    .eq("slug", slug)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Project | undefined;
}

// ----- Project properties ---------------------------------------------------

export async function listProjectProperties(
  project: string,
  ownerId: string
): Promise<ProjectProperty[]> {
  const { data, error } = await supabase
    .from("project_properties")
    .select("*")
    .eq("project", project)
    .eq("owner_id", ownerId)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ProjectProperty[];
}

export interface CreateProjectPropertyInput {
  project: string;
  name: string;
  options?: string[];
  default_value?: string;
  position?: number;
}

export async function createProjectProperty(
  input: CreateProjectPropertyInput
): Promise<ProjectProperty> {
  const { data, error } = await supabase
    .from("project_properties")
    .insert({
      project: input.project,
      name: input.name,
      options: input.options ?? [],
      default_value: input.default_value ?? "",
      position: input.position ?? 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ProjectProperty;
}

export interface UpdateProjectPropertyInput {
  name?: string;
  options?: string[];
  default_value?: string;
  position?: number;
}

export async function updateProjectProperty(
  id: string,
  input: UpdateProjectPropertyInput,
  ownerId: string
): Promise<ProjectProperty | undefined> {
  const patch: {
    name?: string;
    options?: string[];
    default_value?: string;
    position?: number;
  } = {};
  if (typeof input.name === "string") patch.name = input.name;
  if (Array.isArray(input.options)) patch.options = input.options;
  if (typeof input.default_value === "string")
    patch.default_value = input.default_value;
  if (typeof input.position === "number") patch.position = input.position;
  if (Object.keys(patch).length === 0) return getProjectProperty(id, ownerId);

  const { data, error } = await supabase
    .from("project_properties")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as ProjectProperty | undefined;
}

export async function getProjectProperty(
  id: string,
  ownerId: string
): Promise<ProjectProperty | undefined> {
  const { data, error } = await supabase
    .from("project_properties")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as ProjectProperty | undefined;
}

export async function deleteProjectProperty(
  id: string,
  ownerId: string
): Promise<boolean> {
  const { error, count } = await supabase
    .from("project_properties")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// ----- Tickets --------------------------------------------------------------

// Resolve a project's owner from its slug (unscoped — used to derive the owner
// for rows created on the public intake path, which has no signed-in user).
async function projectOwnerId(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  const row = data as { owner_id: string | null } | null;
  return row?.owner_id ?? null;
}

// ----- Public (project-scoped) and worker (token-gated) lookups -------------
// The public intake routes have no signed-in user; they are scoped by the
// PROJECT in the URL instead (a slug is globally unique, so it identifies
// exactly one owner's project). These helpers never take an owner — the
// project slug is the scope.

// A project by its (globally unique) slug. Used by the public project routes
// to resolve the project the request is scoped to.
export async function getProjectBySlug(
  slug: string
): Promise<Project | undefined> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Project | undefined;
}

// All tickets in one project. The project scopes the result.
export async function listProjectTickets(project: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .eq("project", project)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Ticket[];
}

// A single ticket, scoped to a project: returns it only if it belongs to that
// project (so /projects/cba/... can never reach another project's ticket).
export async function getProjectTicket(
  id: string,
  project: string
): Promise<Ticket | undefined> {
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .eq("project", project)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Ticket | undefined;
}


// NB: the *assignee* is `owner_kind` (+ `agent_session_id`); ownership is the
// separate `owner_id` (auth user) we scope by here.
export async function getTicket(
  id: string,
  ownerId: string
): Promise<Ticket | undefined> {
  const { data, error } = await supabase
    .from("tickets")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Ticket | undefined;
}

export interface TicketFilter {
  project?: string;
  status?: TicketStatus;
  /** Assignee kind: "user" (the app owner) or "agent" (any agent session). */
  ownerKind?: OwnerKind;
  /** Narrow to one named agent session (agent_sessions.id). Implies "agent". */
  ownerSessionId?: string;
  /** Exclude tickets with status "done". */
  notDone?: boolean;
  /** Keep only tickets whose property (by id) equals this value. */
  propertyId?: string;
  propertyValue?: string;
  /** Sort by a property value (by id) instead of creation date. */
  sortPropertyId?: string;
  sortDir?: "asc" | "desc";
}

export async function listTickets(
  ownerId: string,
  filter: TicketFilter = {}
): Promise<Ticket[]> {
  let query = supabase.from("tickets").select("*").eq("owner_id", ownerId);
  if (filter.project) query = query.eq("project", filter.project);
  if (filter.status) query = query.eq("status", filter.status);
  else if (filter.notDone) query = query.neq("status", "done");
  if (filter.ownerSessionId) query = query.eq("agent_session_id", filter.ownerSessionId);
  else if (filter.ownerKind) query = query.eq("owner_kind", filter.ownerKind);

  // Filter by a property's value. The id is validated to a uuid before it ever
  // reaches the JSONB path, so it's safe to interpolate.
  if (isPropertyId(filter.propertyId) && filter.propertyValue) {
    query = query.eq(`properties->>${filter.propertyId}`, filter.propertyValue);
  }

  // Sort by a property value when asked, else newest first. Unset values (a
  // missing JSONB key reads as null) always sort last.
  if (isPropertyId(filter.sortPropertyId)) {
    query = query.order(`properties->>${filter.sortPropertyId}`, {
      ascending: filter.sortDir !== "desc",
      nullsFirst: false,
    });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Ticket[];
}

// Tickets in the given statuses, updated within [from, to] (updated_at is a
// proxy for when the ticket reached that status). Oldest first so a summary
// reads chronologically. Optionally scoped to a single project.
export async function listTicketsInRange(
  ownerId: string,
  from: string,
  to: string,
  statuses: TicketStatus[],
  project?: string
): Promise<Ticket[]> {
  if (statuses.length === 0) return [];
  let query = supabase
    .from("tickets")
    .select("*")
    .eq("owner_id", ownerId)
    .in("status", statuses)
    .gte("updated_at", from)
    .lte("updated_at", to);
  if (project) query = query.eq("project", project);

  const { data, error } = await query.order("updated_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Ticket[];
}

export interface CreateTicketInput {
  project: string;
  title: string;
  requester: string;
  description: string;
  images?: string[];
  /** Assignee. Defaults to "user" (the app owner) for the public intake path. */
  ownerKind?: OwnerKind;
  status?: TicketStatus;
  /** Branch to base the work on. Null/omitted means the repo default. */
  base_branch?: string | null;
  /** Initial property values, keyed by ProjectProperty.id. */
  properties?: Record<string, string>;
  /** A Claude session to resume on dispatch instead of starting fresh. */
  cc_seed_session_id?: string | null;
  /** The named agent session (agent_sessions.id) this ticket targets. */
  agentSessionId?: string | null;
}

// Resolve the two assignee columns from an owner intent. The agent assignee is a
// named agent session. "user" (or unset with no session) means the app owner and
// always clears the session; naming a session implies "agent". Shared by create +
// update so the two paths can't drift.
export function resolveOwnerFields(input: {
  ownerKind?: OwnerKind | null;
  agentSessionId?: string | null;
}): { owner_kind: OwnerKind; agent_session_id: string | null } {
  const kind: OwnerKind =
    input.ownerKind === "agent" || (!input.ownerKind && input.agentSessionId)
      ? "agent"
      : "user";
  return {
    owner_kind: kind,
    agent_session_id: kind === "agent" ? input.agentSessionId ?? null : null,
  };
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  // The ticket belongs to whoever owns the project (the public intake path has
  // no signed-in user, so we derive it from the project). A DB trigger also
  // sets owner_id from the project; we set it explicitly to be unambiguous.
  const owner = await projectOwnerId(input.project);

  // Pre-fill any property defaults the caller didn't explicitly set.
  const properties = sanitizeProperties(input.properties) ?? {};
  if (owner) {
    for (const p of await listProjectProperties(input.project, owner)) {
      if (p.default_value && !(p.id in properties)) {
        properties[p.id] = p.default_value;
      }
    }
  }

  const { data, error } = await supabase
    .from("tickets")
    .insert({
      project: input.project,
      title: input.title,
      description: input.description,
      requester: input.requester,
      images: input.images ?? [],
      ...resolveOwnerFields(input),
      status: input.status ?? "requested",
      base_branch: input.base_branch ?? null,
      properties,
      cc_seed_session_id: input.cc_seed_session_id ?? null,
      owner_id: owner,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Ticket;
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  requester?: string;
  /** Reassign the ticket. "user" clears the session; "agent" assigns one. */
  ownerKind?: OwnerKind;
  /** The named agent session (agent_sessions.id) when ownerKind is "agent". */
  agentSessionId?: string | null;
  status?: TicketStatus;
  images?: string[];
  /** Branch to work on. null clears it (a feature/… or fix/… branch is
   * generated from the ticket via {@link ticketBranch}). */
  base_branch?: string | null;
  /** Replace the per-property values map (keyed by ProjectProperty.id). */
  properties?: Record<string, string>;
  /** Toggle commit-after-each-change + PR for the Claude Code session. */
  auto_commit?: boolean;
}

export async function updateTicket(
  id: string,
  input: UpdateTicketInput,
  ownerId: string
): Promise<Ticket | undefined> {
  const patch: {
    title?: string;
    description?: string;
    requester?: string;
    owner_kind?: OwnerKind;
    agent_session_id?: string | null;
    status?: TicketStatus;
    images?: string[];
    base_branch?: string | null;
    properties?: Record<string, string>;
    auto_commit?: boolean;
  } = {};
  if (typeof input.title === "string") patch.title = input.title;
  if (typeof input.description === "string") patch.description = input.description;
  if (typeof input.requester === "string") patch.requester = input.requester;
  if (isOwnerKind(input.ownerKind)) {
    // "user" always clears the session; "agent" assigns it (null if not given).
    const owner = resolveOwnerFields(input);
    patch.owner_kind = owner.owner_kind;
    patch.agent_session_id = owner.agent_session_id;
  }
  if (isStatus(input.status)) patch.status = input.status;
  if (Array.isArray(input.images)) patch.images = input.images;
  if (input.base_branch !== undefined) patch.base_branch = input.base_branch;
  if (typeof input.auto_commit === "boolean") patch.auto_commit = input.auto_commit;
  const props = sanitizeProperties(input.properties);
  if (props !== undefined) patch.properties = props;

  if (Object.keys(patch).length === 0) return getTicket(id, ownerId);

  const { data, error } = await supabase
    .from("tickets")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Ticket | undefined;
}

// Set (or clear) a single property's value on a ticket without disturbing the
// rest of its properties map. Reading then writing keeps one request atomic
// from the caller's view; an empty value removes the key (so it reads as unset).
export async function setTicketProperty(
  id: string,
  propertyId: string,
  value: string,
  ownerId: string
): Promise<Ticket | undefined> {
  if (!isPropertyId(propertyId)) return getTicket(id, ownerId);
  const ticket = await getTicket(id, ownerId);
  if (!ticket) return undefined;

  const next: Record<string, string> = { ...(ticket.properties ?? {}) };
  const v = value.trim();
  if (v) next[propertyId] = v;
  else delete next[propertyId];

  const { data, error } = await supabase
    .from("tickets")
    .update({ properties: next })
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as Ticket | undefined;
}

export interface TicketCcPatch {
  cc_state?: string;
  cc_session_id?: string | null;
  cc_summary?: string | null;
  cc_last_run?: string | null;
  cc_branch?: string | null;
  commits?: TicketCommit[];
  pr_title?: string | null;
  pr_id?: string | null;
  pr_url?: string | null;
  preview_url?: string | null;
}

// Update the Claude Code session-tracking fields on a ticket.
export async function updateTicketCc(
  id: string,
  patch: TicketCcPatch
): Promise<void> {
  const { error } = await supabase.from("tickets").update(patch).eq("id", id);
  if (error) throw error;
}

const CC_STATES: readonly CcState[] = ["idle", "queued", "running", "done", "error"];

export function isCcState(v: string | null | undefined): v is CcState {
  return typeof v === "string" && (CC_STATES as readonly string[]).includes(v);
}

/** What a PATCH /tickets/:id body may carry for the run-tracking fields. */
export interface TicketCcPatchBody {
  cc_state?: string;
  cc_session_id?: string | null;
  cc_summary?: string | null;
  cc_last_run?: string | null;
  cc_branch?: string | null;
  commits?: Array<{ title?: string; link?: string | null; at?: string }>;
  pr_title?: string | null;
  pr_id?: string | null;
  pr_url?: string | null;
  preview_url?: string | null;
}

/** A string, or null to clear; anything else is left alone (undefined). */
function nullableString(v: string | null | undefined): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}

/**
 * The run-tracking patch a request body asks for, validated field by field —
 * the worker reports progress onto its ticket through the API now, and the
 * API must not pass a body through to the database unread. Unknown keys and
 * ill-typed values are dropped; an invalid cc_state is reported so the caller
 * learns about it rather than silently keeping the old state.
 */
export function ticketCcPatchFrom(
  body: TicketCcPatchBody
): { ok: true; patch: TicketCcPatch } | { ok: false; error: string } {
  const patch: TicketCcPatch = {};
  if (body.cc_state !== undefined) {
    if (!isCcState(body.cc_state)) return { ok: false, error: "Invalid cc_state" };
    patch.cc_state = body.cc_state;
  }
  const strings = [
    "cc_session_id",
    "cc_summary",
    "cc_last_run",
    "cc_branch",
    "pr_title",
    "pr_id",
    "pr_url",
    "preview_url",
  ] as const;
  for (const key of strings) {
    const v = nullableString(body[key]);
    if (v !== undefined) patch[key] = v;
  }
  if (Array.isArray(body.commits)) {
    patch.commits = body.commits
      .filter((c): c is { title: string; link?: string | null; at?: string } =>
        !!c && typeof c === "object" && typeof c.title === "string"
      )
      .map((c) => ({
        title: c.title,
        link: typeof c.link === "string" ? c.link : null,
        ...(typeof c.at === "string" ? { at: c.at } : {}),
      }));
  }
  return { ok: true, patch };
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  role: "user" | "assistant";
  content: string;
  /** Attached image/PDF URLs (public ticket-images bucket). */
  images: string[];
  created_at: string;
}

export async function listMessages(ticketId: string): Promise<TicketMessage[]> {
  const { data, error } = await supabase
    .from("ticket_messages")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TicketMessage[];
}

export async function addMessage(
  ticketId: string,
  role: "user" | "assistant",
  content: string,
  images: string[] = []
): Promise<void> {
  const { error } = await supabase
    .from("ticket_messages")
    .insert({ ticket_id: ticketId, role, content, images });
  if (error) throw error;
}

export async function deleteTicket(
  id: string,
  ownerId: string
): Promise<boolean> {
  const { error, count } = await supabase
    .from("tickets")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
  return (count ?? 0) > 0;
}
