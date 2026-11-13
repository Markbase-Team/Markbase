import * as Y from "yjs";
import { diffLines } from "diff";
import { getMarkdown } from "./crdt";
import { agentLabel, listVersions, versionContents, type VersionMeta } from "./versions";

// A document's analytics: which agents read it, how often and on whose
// behalf; and, line by line, who wrote what is in it now — a person, or an
// agent, and whose agent.
//
// Both live in the document's own Y.Doc, beside its content and its versions,
// so every surface that opens the document (the web app, the desktop app)
// shows the same numbers with no table and no endpoint of their own:
//
//   - reads are a tally the sync daemon adds to, from what agents' hooks
//     reported (the vault's agent audit, `markbase read-audit`);
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
  if (agents.length === 0) return { kind: "person", agents: [], person };
  return { kind: version.mixed ? "mixed" : "agent", agents, person };
}

/** A writer in words: "Claude Code · Jessie's", "Jessie", "Jessie + Cursor". */
export function writerText(writer: LineWriter): string {
  const agents = writer.agents.map(agentLabel).join(" + ");
  if (writer.kind === "agent") return writer.person ? `${agents} · ${writer.person}’s` : agents;
  if (writer.kind === "mixed") return `${writer.person ?? "Someone"} + ${agents}`;
  if (writer.kind === "person") return writer.person ?? "Someone";
  return "Not recorded yet";
}

/** The lines of a text, without the empty one a trailing newline leaves. */
function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The text, ending in a newline if it has anything in it. */
function closed(text: string): string {
  return text === "" || text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * Carry line credit across one edit: lines the edit kept keep their writer,
 * lines it added belong to `writer`.
 */
function carry(owners: LineWriter[], before: string, after: string, writer: LineWriter): LineWriter[] {
  const next: LineWriter[] = [];
  let at = 0;
  // Compared with a newline at the end of both: a last line that only gained
  // one (someone wrote below it) was not rewritten, and keeps its writer.
  for (const part of diffLines(closed(before), closed(after))) {
    const count = part.count ?? linesOf(part.value).length;
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
  const shown: CreditedRange[] = [];
  for (const range of ranges) {
    const above = shown[shown.length - 1];
    if (range.preview === "" && above) above.to = range.to;
    else shown.push(range);
  }
  return { ranges: shown, shares, lines: written };
}
