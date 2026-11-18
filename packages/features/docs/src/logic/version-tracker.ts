import type * as Y from "yjs";
import { getMarkdown, observeMarkdown, type Origin } from "./crdt";
import { checkpoint, listVersions, shouldCheckpoint, versionContent, versionCount, type VersionCredit } from "./versions";

// When a client that holds a live Y.Doc should cut a version, and the one rule
// that keeps it honest: only for changes that came in under ITS origin.
//
// Two clients keep a document open and record versions for the edits made
// there — the vault daemon for edits off its disk, the browser editor for
// what is typed in it. Both see every change, including the ones that arrive
// over the bus from somebody else, and a version cut after one of those
// credits that somebody's work to this client's author. The daemon had the
// guard; the browser did not, and credited whatever an agent wrote through
// the API to whoever had the document open when its idle ticker fired. One
// tracker, with the guard built in, for both.
//
// The cadence is shouldCheckpoint's (a thought finished, or a long session
// cut into pieces); this only remembers what that needs between asks.

export class VersionTracker {
  private lastEditAt = 0;
  private lastOrigin: Origin = null;
  private lastAt: number | null = null;
  private lastContent = "";
  private readonly detach: () => void;

  /**
   * Track `doc` for the client whose changes carry `ownOrigin`. Picks up
   * where the document's history left off, so the first edit here is not
   * mistaken for the document's first version ever. A corrupted entry must
   * not take the client down with it: history then starts fresh from here.
   */
  constructor(
    private readonly doc: Y.Doc,
    private readonly ownOrigin: Origin
  ) {
    try {
      const already = versionCount(doc);
      if (already > 0) {
        this.lastAt = listVersions(doc)[already - 1].at;
        this.lastContent = versionContent(doc, already - 1);
      }
    } catch {
      // keep going regardless — content matters more than its history
    }
    this.detach = observeMarkdown(doc, (origin) => {
      this.lastEditAt = Date.now();
      this.lastOrigin = origin;
    });
  }

  /** When the last version was recorded; null when the document has none. */
  get lastVersionAt(): number | null {
    return this.lastAt;
  }

  /** The text the last version recorded. */
  get lastVersionContent(): string {
    return this.lastContent;
  }

  /**
   * Is a version due, and is it this client's to record? A change that
   * arrived under another origin was made elsewhere, on somebody else's
   * machine, and crediting it here is exactly the misattribution to avoid.
   */
  due(now: number = Date.now()): boolean {
    if (this.lastOrigin !== this.ownOrigin) return false;
    return shouldCheckpoint({
      now,
      lastEditAt: this.lastEditAt,
      lastVersionAt: this.lastAt,
      lastVersionContent: this.lastContent,
      content: getMarkdown(this.doc),
    });
  }

  /**
   * Record the document as it stands, credited as `credit` says, at `now` —
   * the one clock, so what the version says and what the next tracker resumes
   * from agree. False when there is nothing new.
   */
  record(credit: VersionCredit, now: number = Date.now()): boolean {
    const content = getMarkdown(this.doc);
    const recorded = checkpoint(this.doc, { ...credit, at: now });
    if (recorded) {
      this.lastAt = now;
      this.lastContent = content;
    }
    return recorded;
  }

  stop(): void {
    this.detach();
  }
}
