// The database half of @markbase/shared/tickets: every query here runs on the web
// server with the secret key. The shapes these return stay in @markbase/shared.

import { supabase } from "../supabase";
import {
  cleanNameList,
  isOwnerKind,
  isStatus,
  type McpConfig,
  type OwnerKind,
  type Project,
  type ProjectProperty,
  type Ticket,
  type TicketStatus,
} from "@markbase/shared/types";
import {
  isPropertyId,
  type CreateProjectInput,
  DEFAULT_PROJECT_PROPERTIES,
  type UpdateProjectInput,
  type CreateProjectPropertyInput,
  type UpdateProjectPropertyInput,
  type TicketFilter,
  type CreateTicketInput,
  resolveOwnerFields,
  type UpdateTicketInput,
  type TicketCcPatch,
  type TicketMessage,
} from "@markbase/shared/tickets";

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

// Update the Claude Code session-tracking fields on a ticket.
export async function updateTicketCc(
  id: string,
  patch: TicketCcPatch
): Promise<void> {
  const { error } = await supabase.from("tickets").update(patch).eq("id", id);
  if (error) throw error;
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
