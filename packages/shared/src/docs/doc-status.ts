import type { JSONValue } from "./types";
import { splitFrontmatter } from "./markdown";

// Doc types, layer 1: the fixed core fields Markbase's own features read, and
// what Markbase works out about a document from them, its history and its
// confirmations. Design: "Doc types v2: fixed core, user types, rules" in the
// Markbase vault.
//
// Front matter is never refused. Anyone can write it — a person by hand, the
// desktop app from a local folder, a GitHub sync, an agent — so a core field
// with a value this module does not understand is kept in the file, treated as
// absent here, and reported as a warning. Fields that are not core are not
// this module's business at all.
//
// Front matter holds declarations. What Markbase works out (trust, whether a
// review is due) is computed here and never written back into the document.
// Trust in particular comes only from confirmations the server recorded as the
// signed-in caller (docs.doc_confirmations), never from front matter: a
// `verified:` line anyone can type would be a confirmation anyone can forge.

/**
 * The core fields. Their names and meanings are Markbase's; a vault can't
 * reuse them. `verified` is reserved (OKF's name for confirmations) but never
 * read as one.
 */
export const CORE_FIELDS = [
  "type",
  "status",
  "superseded_by",
  "owner",
  "audience",
  "covers",
  "review_by",
  "verified",
] as const;
export type CoreField = (typeof CORE_FIELDS)[number];

export const DOC_STATUSES = ["draft", "stable", "deprecated"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const AUDIENCES = ["human", "agent", "both"] as const;
export type Audience = (typeof AUDIENCES)[number];

/**
 * Who did something, as one string: `human:<id>`, `agent:<name>`,
 * `rule:<id>`, `team:<id>`. Any other scheme is accepted and counts as not
 * human.
 */
export type ActorRef = string;

/** A confirmation as the server recorded it. */
export interface Confirmation {
  by: ActorRef;
  /** ISO 8601. */
  at: string;
}

export interface CoreFields {
  /** Absent: `doc`. */
  type: string;
  /** Absent: `stable`. */
  status: DocStatus;
  superseded_by: string | null;
  owner: ActorRef | null;
  /** Absent: `both`. */
  audience: Audience;
  covers: string[];
  /** ISO 8601, as written. */
  review_by: string | null;
}

export interface FieldWarning {
  field: CoreField;
  message: string;
}

export type Trust = "unverified" | "agent_confirmed" | "human_confirmed";

/** Who a version credits, as the history records it (versions.ts). */
export interface VersionWriter {
  /** The person: the editor, or the owner of the agent that edited. */
  author?: string;
  /** The agents whose writes are in the version ("claude", "codex"). */
  agents?: string[];
  /** With `agents`: the person edited in this version too. */
  mixed?: boolean;
}

/** One version of a document as this module needs it. */
export interface VersionText extends VersionWriter {
  /** Milliseconds since the epoch. */
  at: number;
  /** The whole markdown, front matter included. */
  content: string;
}

/** The last version that changed what the document says. */
export interface MeaningfulChange extends VersionWriter {
  /** Its index in the history. */
  index: number;
  /** Milliseconds since the epoch. */
  at: number;
}

/** What Markbase works out about a document. Read-only; never written to the file. */
export interface DocStatusReport {
  fields: CoreFields;
  warnings: FieldWarning[];
  /** ISO 8601: the last version that changed what the document says. Null: no history. */
  last_meaningful_change: string | null;
  trust: Trust;
  /** The confirmations that still count: made at or after the last meaningful change. */
  current_confirmations: Confirmation[];
  /** Now is at or past `review_by`. */
  needs_review: boolean;
}

const isHuman = (by: ActorRef) => by.startsWith("human:");

/** A date-only or offset date-time, as OKF and RFC 3339 allow. A date-time without an offset is not. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))?$/i;

/** Milliseconds for an ISO 8601 date or date-time; NaN when it isn't one. A bare date is the start of that day, UTC. */
export function timestampMs(value: string): number {
  if (!TIMESTAMP_RE.test(value.trim())) return NaN;
  return Date.parse(value.trim().length === 10 ? `${value.trim()}T00:00:00Z` : value.trim());
}

/** js-yaml reads an unquoted date as a Date; keep every timestamp as the string it was. */
function asTimestamp(value: JSONValue | Date | undefined): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string") return null;
  return Number.isNaN(timestampMs(value)) ? null : value.trim();
}

const empty = (v: unknown) => v === undefined || v === null || v === "";

/**
 * The core fields of a front matter block, with defaults for what is absent
 * and a warning for every value that can't be used. Never throws.
 */
export function readCoreFields(frontmatter: Record<string, JSONValue> | null): {
  fields: CoreFields;
  warnings: FieldWarning[];
} {
  const fm = (frontmatter ?? {}) as Record<string, JSONValue | Date | undefined>;
  const warnings: FieldWarning[] = [];
  const warn = (field: CoreField, message: string) => warnings.push({ field, message });

  const text = (field: CoreField): string | null => {
    const v = fm[field];
    if (empty(v)) return null;
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    warn(field, `\`${field}\` should be text.`);
    return null;
  };

  const oneOf = <T extends string>(field: CoreField, allowed: readonly T[], fallback: T): T => {
    const v = text(field);
    if (v === null) return fallback;
    if ((allowed as readonly string[]).includes(v)) return v as T;
    warn(field, `\`${field}: ${v}\` isn't one of ${allowed.join(", ")}; read as ${fallback}.`);
    return fallback;
  };

  const status = oneOf("status", DOC_STATUSES, "stable");
  const superseded_by = text("superseded_by");
  if (superseded_by && status !== "deprecated") {
    warn("superseded_by", "`superseded_by` only means something with `status: deprecated`.");
  }

  let covers: string[] = [];
  const rawCovers = fm.covers;
  if (typeof rawCovers === "string" && rawCovers.trim()) covers = [rawCovers.trim()];
  else if (Array.isArray(rawCovers)) {
    covers = rawCovers.filter((c): c is string => typeof c === "string" && c.trim() !== "").map((c) => c.trim());
    if (covers.length !== rawCovers.length) warn("covers", "Some `covers` entries aren't paths and were skipped.");
  } else if (!empty(rawCovers)) warn("covers", "`covers` should be a path or a list of paths.");

  let review_by: string | null = null;
  if (!empty(fm.review_by)) {
    review_by = asTimestamp(fm.review_by);
    if (review_by === null) warn("review_by", "`review_by` should be a date like 2026-12-31.");
  }

  if (!empty(fm.verified)) {
    warn("verified", "`verified` in front matter isn't counted. Confirm the document in Markbase instead.");
  }

  return {
    fields: {
      type: text("type") ?? "doc",
      status,
      superseded_by,
      owner: text("owner"),
      audience: oneOf("audience", AUDIENCES, "both"),
      covers,
      review_by,
    },
    warnings,
  };
}

/**
 * What a document says, for telling a meaningful change from a cosmetic one:
 * the body without front matter, with emphasis markers and whitespace taken
 * out. Reformatting or re-wrapping leaves it the same; changing a word or
 * where a link points doesn't.
 */
export function meaningOf(markdown: string): string {
  const { body } = splitFrontmatter(markdown);
  return body.replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();
}

/** The newest version whose meaning differs from the one before it (the first version, if none does). */
export function lastMeaningfulChange(versions: readonly VersionText[]): MeaningfulChange | null {
  if (versions.length === 0) return null;
  let i = versions.length - 1;
  while (i > 0 && meaningOf(versions[i].content) === meaningOf(versions[i - 1].content)) i--;
  const { at, author, agents, mixed } = versions[i];
  return { index: i, at, author, agents, mixed };
}

/**
 * Whether a confirmer wrote the change they would be confirming. A person
 * can't vouch for their own words, nor an agent for its own: a confirmation is
 * a second look. The history names a person by display name and an agent by
 * tool, so that is what is compared.
 */
export function confirmsOwnChange(
  change: VersionWriter | null,
  confirmer: { kind: "human"; name: string } | { kind: "agent"; tool: string },
): boolean {
  if (!change) return false;
  const agents = change.agents ?? [];
  if (confirmer.kind === "agent") return agents.includes(confirmer.tool);
  const personWrote = agents.length === 0 || change.mixed === true;
  return personWrote && change.author === confirmer.name;
}

/** The trust tier from the confirmations that still count. */
export function trustOf(current: readonly Confirmation[]): Trust {
  if (current.some((c) => isHuman(c.by))) return "human_confirmed";
  return current.length ? "agent_confirmed" : "unverified";
}

/**
 * Everything Markbase works out about a document from its current markdown,
 * its history (oldest first; empty when there is none) and the confirmations
 * the server recorded (oldest first).
 */
export function docStatus(
  markdown: string,
  versions: readonly VersionText[],
  confirmations: readonly Confirmation[],
  now: number = Date.now(),
): DocStatusReport {
  const { fields, warnings } = readCoreFields(splitFrontmatter(markdown).frontmatter);
  const changed = lastMeaningfulChange(versions);
  // A confirmation counts only for the text it saw: one made before the last
  // meaningful change was of different words.
  const current = confirmations.filter((c) => changed === null || Date.parse(c.at) >= changed.at);
  return {
    fields,
    warnings,
    last_meaningful_change: changed === null ? null : new Date(changed.at).toISOString(),
    trust: trustOf(current),
    current_confirmations: current,
    needs_review: fields.review_by !== null && now >= timestampMs(fields.review_by),
  };
}
