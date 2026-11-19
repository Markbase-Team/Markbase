import * as Y from "yjs";
import { diffArrays } from "diff";
import { getMarkdown } from "./crdt";
import { agentLabel, listVersions, versionContents, type VersionMeta } from "./versions";

// A document's analytics: which agents read it, how often and on whose
// behalf; and, line by line, who wrote what is in it now — a person, or an
// agent, and whose agent.
//
// Both live in the document's own Y.Doc, beside its content and its versions,
// so there is no table of their own: whoever holds the Y.Doc can work them out.
// The server does, for GET /docs/:id/analytics (`docAnalytics` below), which is
// what the web app, the desktop app and an agent's MCP tool all ask:
//
//   - reads are a tally added to from two places: the sync daemon, from what
//     agents' hooks reported of the files (`markbase read-audit`), and the
//     server, when an agent reads the document through the API (an MCP tool;
//     `addApiRead`, at most once a minute per agent). Both name the reader
//     the same way, so one agent has one row;
//   - line credit is not stored at all. It is worked out from the versions,
//     each of which already says who wrote it (versions.ts): a line belongs
//     to the version that last changed it.
//
// "Whose agent" is the person whose machine the agent ran on — the account
// the sync daemon there is signed in to.

const READS_KEY = "agentReads";

/** How often one agent, working for one person, read this document. */
export interface AgentReadTally {
  /** "claude", "codex", "cursor", or whatever the hook named. */
  agent: string;
  /** The person whose agent it is; null when the daemon could not tell. */
  owner: string | null;
  count: number;
  /** When it last read it, in milliseconds. */
  lastAt: number;
}

function readsMap(doc: Y.Doc): Y.Map<AgentReadTally> {
  return doc.getMap<AgentReadTally>(READS_KEY);
}

function tallyKey(agent: string, owner: string | null): string {
  return `${owner ?? ""}\n${agent}`;
}

/**
 * Add reads to the document's tally. `count` is how many more, not the new
 * total. Two machines adding at the same instant can lose one of the two
 * additions — a tally is not worth a counter type, and says "about".
 */
export function addAgentReads(doc: Y.Doc, reads: AgentReadTally[]): void {
  if (reads.length === 0) return;
  const map = readsMap(doc);
  doc.transact(() => {
    for (const read of reads) {
      const key = tallyKey(read.agent, read.owner);
      const had = map.get(key);
      map.set(key, {
        agent: read.agent,
        owner: read.owner,
        count: (had?.count ?? 0) + read.count,
        lastAt: Math.max(had?.lastAt ?? 0, read.lastAt),
      });
    }
  });
}

/**
 * How close together one agent's reads through the API count as one. An agent
 * reading a document over MCP often reads it, edits, and reads it again within
 * seconds; that is one look at the document, and each counted read is a write
 * to the CRDT.
 */
export const API_READ_WINDOW_MS = 60_000;

/**
 * Add one read made through the API, unless the same agent for the same
 * person already read it within `windowMs`. True when the tally changed.
 */
export function addApiRead(
  doc: Y.Doc,
  read: { agent: string; owner: string | null },
  now: number,
  windowMs: number = API_READ_WINDOW_MS
): boolean {
  const had = readsMap(doc).get(tallyKey(read.agent, read.owner));
  if (had && now - had.lastAt < windowMs) return false;
  addAgentReads(doc, [{ agent: read.agent, owner: read.owner, count: 1, lastAt: now }]);
  return true;
}

/** Every agent's reads of the document, most first. */
export function listAgentReads(doc: Y.Doc): AgentReadTally[] {
  return [...readsMap(doc).values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

/** Call `onChange` whenever the read tally changes; returns the way to stop. */
export function watchAgentReads(doc: Y.Doc, onChange: () => void): () => void {
  const map = readsMap(doc);
  map.observe(onChange);
  return () => map.unobserve(onChange);
}

/** Who wrote a line. */
export interface LineWriter {
  /**
   * "agent": an agent wrote it. "person": a person did. "mixed": the version
   * it came in held both a person's edits and an agent's, so it is one or the
   * other. "unrecorded": it is newer than the last version, or older than the
   * first.
   */
  kind: "agent" | "person" | "mixed" | "unrecorded";
  /** The agents, as their hooks named them. Empty unless agent or mixed. */
  agents: string[];
  /** The person: the writer, or for an agent the person whose agent it is. */
  person: string | null;
}

function sameWriter(a: LineWriter, b: LineWriter): boolean {
  return a.kind === b.kind && a.person === b.person && a.agents.join("\n") === b.agents.join("\n");
}

const UNRECORDED: LineWriter = { kind: "unrecorded", agents: [], person: null };

function writerOf(version: VersionMeta): LineWriter {
  const agents = version.agents ?? [];
  const person = version.author ?? null;
  // No person and no agent named: the edit came in as a file changed on disk
  // with no hook to say who, which is how agents edit a vault. Credited to an
  // agent rather than to an anonymous "someone".
  if (agents.length === 0 && person === null) return { kind: "agent", agents: [], person: null };
  if (agents.length === 0) return { kind: "person", agents: [], person };
  return { kind: version.mixed ? "mixed" : "agent", agents, person };
}

/** A writer in words: "Jessie's Claude", "Jessie", "Jessie + Cursor". */
export function writerText(writer: LineWriter): string {
  const agents = writer.agents.map(agentLabel).join(" + ") || "Agent";
  if (writer.kind === "agent") return writer.person ? `${writer.person}'s ${agents}` : agents;
  if (writer.kind === "mixed") return writer.person ? `${writer.person} + ${agents}` : agents;
  if (writer.kind === "person") return writer.person ?? "Agent";
  return "Not recorded yet";
}

/** The lines of a text, without the empty one a trailing newline leaves. */
function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * A line as it counts for credit: without its spacing, and with a table's
 * rule (`| --- | :---: |`) reduced to its shortest spelling. An editor that
 * saves a document re-spaces its tables and re-draws their rules; a line that
 * changed only that way was not rewritten, and keeps its writer.
 */
function essence(line: string): string {
  return line.replace(/\s+/g, "").replace(/-{3,}/g, "---");
}

/**
 * Carry line credit across one edit: lines the edit kept keep their writer,
 * lines it added belong to `writer`.
 */
function carry(owners: LineWriter[], before: string, after: string, writer: LineWriter): LineWriter[] {
  const next: LineWriter[] = [];
  let at = 0;
  // Compared line by line, by what each says (essence): a last line that only
  // gained a newline, or a table an editor re-spaced, was not rewritten.
  const parts = diffArrays(linesOf(before), linesOf(after), {
    comparator: (a, b) => essence(a) === essence(b),
  });
  for (const part of parts) {
    const count = part.value.length;
    if (part.removed) {
      at += count;
    } else if (part.added) {
      for (let i = 0; i < count; i++) next.push(writer);
    } else {
      for (let i = 0; i < count; i++) next.push(owners[at + i] ?? UNRECORDED);
      at += count;
    }
  }
  return next;
}

/** A run of consecutive lines by one writer. */
export interface CreditedRange {
  /** 1-based, inclusive. */
  from: number;
  to: number;
  writer: LineWriter;
  /** The first line of the run that has text in it, for showing what it is. */
  preview: string;
}

/** How much of the document one writer wrote. */
export interface WriterShare {
  writer: LineWriter;
  /** Lines with text in them; blank lines belong to nobody worth counting. */
  lines: number;
}

export interface LineCredit {
  /** Every run of lines and who wrote it, top to bottom. */
  ranges: CreditedRange[];
  /** Each writer's share, most lines first. */
  shares: WriterShare[];
  /** Lines with text in them, in all. */
  lines: number;
}

/**
 * Who wrote each line of the document as it is now.
 *
 * Walks the versions oldest to newest: a version's added lines are its
 * writer's, and anything changed since the last version is not recorded yet.
 * What it can say is bounded by what the versions say — a version is credited
 * to an agent only where the agent's hook reported the write.
 */
export function lineCredit(doc: Y.Doc): LineCredit {
  const versions = listVersions(doc);
  const contents = versionContents(doc);
  let owners: LineWriter[] = [];
  let text = "";
  for (let i = 0; i < versions.length; i++) {
    owners = carry(owners, text, contents[i], writerOf(versions[i]));
    text = contents[i];
  }
  const now = getMarkdown(doc);
  owners = carry(owners, text, now, UNRECORDED);

  const lines = linesOf(now);
  const ranges: CreditedRange[] = [];
  const shares: WriterShare[] = [];
  let written = 0;
  for (let i = 0; i < lines.length; i++) {
    const writer = owners[i] ?? UNRECORDED;
    const hasText = lines[i].trim() !== "";
    const last = ranges[ranges.length - 1];
    if (last && sameWriter(last.writer, writer)) {
      last.to = i + 1;
      if (last.preview === "" && hasText) last.preview = lines[i].trim();
    } else {
      ranges.push({ from: i + 1, to: i + 1, writer, preview: hasText ? lines[i].trim() : "" });
    }
    if (!hasText) continue;
    written++;
    const share = shares.find((s) => sameWriter(s.writer, writer));
    if (share) share.lines++;
    else shares.push({ writer, lines: 1 });
  }
  shares.sort((a, b) => b.lines - a.lines);
  // A run of nothing but blank lines says nothing; fold it into the run above.
  // That can leave two runs by one writer touching: they are one run.
  const shown: CreditedRange[] = [];
  for (const range of ranges) {
    const above = shown[shown.length - 1];
    if (above && (range.preview === "" || sameWriter(above.writer, range.writer))) above.to = range.to;
    else shown.push(range);
  }
  return { ranges: shown, shares, lines: written };
}

/** An agent's reads, with who it is in words. */
export interface AgentReadReport extends AgentReadTally {
  /** "Jessie's Claude"; the agent alone when nobody is known to own it. */
  text: string;
}

/** A writer's share, with the writer in words. */
export interface WriterShareReport extends WriterShare {
  text: string;
}

/** A run of lines, with its writer in words. */
export interface CreditedRangeReport extends CreditedRange {
  text: string;
}

/**
 * A document's analytics as one answer — what GET /docs/:id/analytics returns.
 * Every writer comes with its wording, so a caller shows "Jessie's Claude"
 * without knowing how that is put together.
 */
export interface DocAnalyticsReport {
  /** Every agent's reads, most first. */
  reads: AgentReadReport[];
  /** Null when a version cannot be rebuilt: nothing, rather than a guess. */
  credit: {
    ranges: CreditedRangeReport[];
    shares: WriterShareReport[];
    lines: number;
  } | null;
}

/** Whose agent read it, in words: "Jessie's Claude", or "Claude". */
export function readerText(read: AgentReadTally): string {
  const agent = agentLabel(read.agent);
  return read.owner ? `${read.owner}'s ${agent}` : agent;
}

/** The document's analytics: `listAgentReads` and `lineCredit`, worded. */
export function docAnalytics(doc: Y.Doc): DocAnalyticsReport {
  const reads = listAgentReads(doc).map((read) => ({ ...read, text: readerText(read) }));
  let credit: LineCredit;
  try {
    credit = lineCredit(doc);
  } catch {
    return { reads, credit: null };
  }
  return {
    reads,
    credit: {
      ranges: credit.ranges.map((range) => ({ ...range, text: writerText(range.writer) })),
      shares: credit.shares.map((share) => ({ ...share, text: writerText(share.writer) })),
      lines: credit.lines,
    },
  };
}
