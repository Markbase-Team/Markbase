// Versioning / history (roadmap B3).
//
// A version is a markdown diff, stored as one ITEM in a Y.Array that lives in the
// same Y.Doc as the content:
//
//   Y.Doc
//   ├── "source"   : Y.Text   — the markdown. The truth.
//   └── "versions" : Y.Array  — one item per version, each holding one patch.
//
// Two decisions worth knowing, because both look arbitrary until they don't:
//
// WHY IN THE CRDT. The roadmap promises (lines 50/59/69-71) that versions travel
// in the sidecar, so an iCloud-only vault keeps its history with no server. Put
// them in Postgres and that promise breaks. Here, they ride along for free — and
// two devices appending offline merge, which is what a Y.Array is FOR.
//
// WHY NOT Y.snapshot(). The roadmap originally said "periodic Y.snapshot()
// checkpoints". A snapshot is an 18-byte RECEIPT — "I'd seen this much of each
// writer, and these things were deleted". Redeeming it requires the goods still in
// the warehouse, so it forces gc:false: every character ever typed and deleted is
// kept forever, in the LIVE document, loaded on every open and every sync by
// everyone. Measured at up to 300x for a revised doc. A markdown diff is
// self-contained — it refers to no history at all — so gc stays on, the Y.Text
// stays lean, and history is read only when someone asks for it.

import { applyPatch, createPatch } from "diff";
import * as Y from "yjs";
import { diffCounts, diffSegments, type DiffSegment } from "./diff";
import { getMarkdown, setMarkdown } from "./crdt";

const VERSIONS_KEY = "versions";

/**
 * Store the whole markdown every this many versions.
 *
 * Reconstruction walks back to the nearest full copy and replays forward, so this
 * bounds that walk. 20 small patches replay in well under a millisecond; without a
 * bound, version 900 would replay 900 of them.
 */
export const KEYFRAME_EVERY = 20;

/** One version, as stored. Exactly one of `full`/`patch` is set. */
interface VersionEntry {
  at: number;
  label?: string;
  author?: string;
  agents?: string[];
  mixed?: boolean;
  /** The complete markdown — a keyframe. */
  full?: string;
  /** A unified diff from the PREVIOUS version's markdown. */
  patch?: string;
  added: number;
  removed: number;
}

/** What a history list shows, without reconstructing any content. */
export interface VersionMeta {
  index: number;
  at: number;
  label?: string;
  /** The person — whose account, and for a file edit whose machine. */
  author?: string;
  /**
   * The agents whose writes are in this version ("claude", "codex", "cursor"),
   * as their own hooks reported them (the vault's agent audit). Absent when no
   * agent is known to have written any of it.
   */
  agents?: string[];
  /** With `agents`: the person edited in this version too, so it is not all the agents'. */
  mixed?: boolean;
  added: number;
  removed: number;
}

function log(doc: Y.Doc): Y.Array<VersionEntry> {
  return doc.getArray<VersionEntry>(VERSIONS_KEY);
}

export function versionCount(doc: Y.Doc): number {
  return log(doc).length;
}

/** Every version's metadata, oldest first. */
export function listVersions(doc: Y.Doc): VersionMeta[] {
  return log(doc)
    .toArray()
    .map((e, index) => ({
      index,
      at: e.at,
      ...(e.label === undefined ? {} : { label: e.label }),
      ...(e.author === undefined ? {} : { author: e.author }),
      ...(e.agents === undefined ? {} : { agents: e.agents }),
      ...(e.mixed === undefined ? {} : { mixed: e.mixed }),
      added: e.added,
      removed: e.removed,
    }));
}

/**
 * The markdown as of version `index`: walk back to the nearest keyframe, then
 * replay the patches forward.
 */
export function versionContent(doc: Y.Doc, index: number): string {
  const entries = log(doc).toArray();
  if (index < 0 || index >= entries.length) throw new Error(`No version ${index}`);

  let start = index;
  while (start > 0 && entries[start].full === undefined) start--;

  let content = entries[start].full ?? "";
  for (let i = start + 1; i <= index; i++) {
    const patch = entries[i].patch;
    if (patch === undefined) {
      content = entries[i].full ?? content;
      continue;
    }
    const next = applyPatch(content, patch);
    // `false` means the patch didn't apply — impossible unless an entry was
    // corrupted, and silently returning the wrong text would be worse than saying so.
    if (next === false) throw new Error(`Version ${i} could not be reconstructed`);
    content = next;
  }
  return content;
}

/**
 * The markdown of every version, oldest first — each built from the one
 * before it, where `versionContent` would walk back to a keyframe for every
 * index asked. For a reader that needs them all (line credit).
 */
export function versionContents(doc: Y.Doc): string[] {
  const contents: string[] = [];
  let content = "";
  for (const entry of log(doc).toArray()) {
    if (entry.patch === undefined) {
      content = entry.full ?? content;
    } else {
      const next = applyPatch(content, entry.patch);
      if (next === false) throw new Error(`Version ${contents.length} could not be reconstructed`);
      content = next;
    }
    contents.push(content);
  }
  return contents;
}

/** Who and what a version is credited to, and when. */
export interface VersionCredit {
  label?: string;
  author?: string;
  agents?: string[];
  mixed?: boolean;
  at?: number;
}

/** An agent's name as people know it: "claude" is Claude Code. */
export function agentLabel(agent: string): string {
  const known: Record<string, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" };
  return known[agent.toLowerCase()] ?? agent;
}

/**
 * Who a version is credited to, in words: the agents when it is all theirs,
 * the person and the agents when both edited, else the person (null when
 * nobody is named).
 */
export function versionCreditText(v: { author?: string; agents?: string[]; mixed?: boolean }): string | null {
  const agents = (v.agents ?? []).map(agentLabel);
  if (agents.length === 0) return v.author ?? null;
  if (v.mixed) return [v.author ?? "You", ...agents].join(" + ");
  return agents.join(" + ");
}

/**
 * Record `markdown` as a new version. Returns false if it's identical to the last
 * one — the daemon flushes constantly and the editor fires on every keystroke, so
 * without that guard the log fills with thousands of identical entries.
 */
export function appendVersion(
  doc: Y.Doc,
  markdown: string,
  meta: VersionCredit = {}
): boolean {
  const entries = log(doc);
  const count = entries.length;
  const previous = count === 0 ? "" : versionContent(doc, count - 1);
  if (count > 0 && previous === markdown) return false;

  const { added, removed } = diffCounts(previous, markdown);
  const entry: VersionEntry = {
    at: meta.at ?? Date.now(),
    ...(meta.label === undefined ? {} : { label: meta.label }),
    ...(meta.author === undefined ? {} : { author: meta.author }),
    ...(meta.agents === undefined || meta.agents.length === 0 ? {} : { agents: meta.agents }),
    ...(meta.mixed === true && meta.agents !== undefined && meta.agents.length > 0 ? { mixed: true } : {}),
    added,
    removed,
  };

  // A patch is ~10x smaller than a copy on a real document — but on a small one
  // the unified-diff header costs more than the content it describes. Store
  // whichever is smaller, so the log is never worse than plain snapshots and much
  // better where it matters. The first entry and every keyframe are always whole.
  const dueKeyframe = count % KEYFRAME_EVERY === 0;
  const patch = dueKeyframe ? null : createPatch("doc", previous, markdown, "", "", { context: 3 });
  if (patch !== null && patch.length < markdown.length) entry.patch = patch;
  else entry.full = markdown;

  entries.push([entry]);
  return true;
}

/** Record the document's CURRENT markdown as a version. */
export function checkpoint(doc: Y.Doc, meta: VersionCredit = {}): boolean {
  return appendVersion(doc, getMarkdown(doc), meta);
}

/**
 * Is it time to record one?
 *
 * The op-log already has every keystroke. A VERSION should mean "a thought
 * finished", or history becomes a wall of noise nobody can navigate. So: once
 * editing settles, or periodically through a long unbroken session — otherwise two
 * hours of writing collapses into a single useless entry.
 */
export function shouldCheckpoint(input: {
  now: number;
  /** When the content last changed. */
  lastEditAt: number;
  /** When we last recorded a version; null if never. */
  lastVersionAt: number | null;
  lastVersionContent: string;
  content: string;
  /** Quiet time that means "they're done". */
  idleMs?: number;
  /** Record anyway after this long, however busy they are. */
  maxMs?: number;
}): boolean {
  if (input.content === input.lastVersionContent) return false; // nothing new to say
  if (input.lastVersionAt === null) return true; // the first version
  const idleMs = input.idleMs ?? 2 * 60_000;
  const maxMs = input.maxMs ?? 10 * 60_000;
  return input.now - input.lastEditAt >= idleMs || input.now - input.lastVersionAt >= maxMs;
}

/**
 * What changed IN version `index` — the diff against the version before it.
 *
 * A function OF the doc, not a stored field, because reconstruction is the
 * expensive half (walk to a keyframe, replay patches). A history list shows +N/−M
 * from the counts recorded at append time and reconstructs nothing; only clicking
 * a version pays for it.
 *
 * Version 0 has no predecessor, so it's diffed against the empty string: the
 * honest reading is that everything in the first version is new.
 */
export function versionDiff(doc: Y.Doc, index: number): DiffSegment[] {
  const before = index > 0 ? versionContent(doc, index - 1) : "";
  return diffSegments(before, versionContent(doc, index));
}

/**
 * Restore an old version by writing it back as a NEW edit — never by rewinding.
 *
 * The roadmap's own words: "append as a new state". Anything else would mean
 * deleting history that other devices still hold, which a CRDT will simply merge
 * back; and it keeps restore honest — undoing a restore is just another restore.
 */
export function restoreVersionContent(doc: Y.Doc, index: number): string {
  return versionContent(doc, index);
}

/**
 * Make version `index` the document's current content, by WRITING IT BACK as an
 * ordinary edit.
 *
 * Nothing is rewound: the versions it restored from all remain, so undoing a
 * restore is just another restore, and the restore itself becomes history once
 * editing settles. That falls out of appending rather than being a special case —
 * and it has to, because rewinding would delete history other devices still hold,
 * which a CRDT would merge straight back.
 *
 * Throws for an index that isn't there rather than blanking the document.
 */
export function restoreVersion(doc: Y.Doc, index: number): string {
  const content = versionContent(doc, index); // throws before we touch anything
  setMarkdown(doc, content);
  return content;
}
