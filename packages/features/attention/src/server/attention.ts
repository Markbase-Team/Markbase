import { randomUUID } from "node:crypto";
import { getAttentionDb } from "./supabase";
import { chatJson } from "@markbase/llm";

// Attention boards = a kanban of "things that need your attention". Emails are
// filed onto a board by dragging them from the Inbox onto the Attention sidebar
// region; classifyEmail decides which board (structured rules first, then a
// cheap model). See migration 20260531_attention_boards.sql.

export type AttentionBoard = {
  id: string;
  name: string;
  color: string;
  sender_domains: string[];
  keywords: string[];
  rules: string;
  position: number;
};

export type AttentionItemStatus = "filed" | "needs_approval";
export type AttentionPriority = "high" | "medium" | "low";

export type AttentionItem = {
  id: string;
  board_id: string;
  account_id: string | null;
  message_id: string;
  thread_id: string | null;
  from_addr: string;
  subject: string;
  snippet: string;
  summary: string;
  email_date: string;
  status: AttentionItemStatus;
  priority: AttentionPriority | null;
  position: number;
  created_at: string;
};

const BOARD_COLS = "id, name, color, sender_domains, keywords, rules, position";
const ITEM_COLS =
  "id, board_id, account_id, message_id, thread_id, from_addr, subject, snippet, summary, email_date, status, priority, position, created_at";

// ---- Board CRUD ---------------------------------------------------------

export async function listBoards(): Promise<AttentionBoard[]> {
  const { data, error } = await getAttentionDb()
    .from("attention_boards")
    .select(BOARD_COLS)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AttentionBoard[];
}

export type BoardInput = {
  name: string;
  color?: string;
  sender_domains?: string[];
  keywords?: string[];
  rules?: string;
  position?: number;
};

export async function createBoard(input: BoardInput): Promise<AttentionBoard> {
  const { data, error } = await getAttentionDb()
    .from("attention_boards")
    .insert({
      name: input.name,
      color: input.color ?? "#e5ff6e",
      sender_domains: input.sender_domains ?? [],
      keywords: input.keywords ?? [],
      rules: input.rules ?? "",
      position: input.position ?? 0,
    })
    .select(BOARD_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as AttentionBoard;
}

export async function updateBoard(
  id: string,
  input: Partial<BoardInput>
): Promise<AttentionBoard> {
  const patch: Partial<BoardInput> & { updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.color !== undefined) patch.color = input.color;
  if (input.sender_domains !== undefined)
    patch.sender_domains = input.sender_domains;
  if (input.keywords !== undefined) patch.keywords = input.keywords;
  if (input.rules !== undefined) patch.rules = input.rules;
  if (input.position !== undefined) patch.position = input.position;

  const { data, error } = await getAttentionDb()
    .from("attention_boards")
    .update(patch)
    .eq("id", id)
    .select(BOARD_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as AttentionBoard;
}

export async function deleteBoard(id: string): Promise<void> {
  const { error } = await getAttentionDb()
    .from("attention_boards")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---- Item CRUD ----------------------------------------------------------

// Just the Gmail message ids that have been filed onto any board — used by the
// Inbox to flag rows that are already in Attention.
export async function listFiledMessageIds(): Promise<string[]> {
  const { data, error } = await getAttentionDb()
    .from("attention_items")
    .select("message_id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => (r as { message_id: string }).message_id);
}

// A manually-added card carries no email. Its message_id is prefixed so the
// rest of the app can tell it apart (no Gmail message to open or mark read).
export const MANUAL_PREFIX = "manual:";

export function isManualItem(item: Pick<AttentionItem, "message_id">): boolean {
  return item.message_id.startsWith(MANUAL_PREFIX);
}

export type ManualItemInput = {
  board_id: string;
  subject: string;
  summary?: string;
  priority?: AttentionPriority | null;
};

// Create a card by hand (no email behind it). Filed straight away — there's
// nothing to approve. A synthetic message_id keeps the unique (board, message)
// constraint happy and marks the row as manual.
export async function createManualItem(
  input: ManualItemInput
): Promise<AttentionItem> {
  const { data, error } = await getAttentionDb()
    .from("attention_items")
    .insert({
      board_id: input.board_id,
      account_id: null,
      message_id: `${MANUAL_PREFIX}${randomUUID()}`,
      thread_id: null,
      from_addr: "Manual",
      subject: input.subject,
      snippet: input.summary ?? "",
      summary: input.summary ?? "",
      email_date: "",
      status: "filed",
      priority: input.priority ?? null,
      position: 0,
    })
    .select(ITEM_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as AttentionItem;
}

export type FileEmailInput = {
  board_id: string;
  account_id: string;
  message_id: string;
  thread_id?: string | null;
  from: string;
  subject: string;
  snippet: string;
  date?: string;
};

// File a specific email onto a chosen board (e.g. found via search), as a real,
// email-backed card — filed straight away (the user picked the board, so no AI
// classification or approval). Upsert on (board, message) so re-filing the same
// email updates the card instead of duplicating it.
export async function fileEmailOnBoard(
  input: FileEmailInput
): Promise<AttentionItem> {
  const { data, error } = await getAttentionDb()
    .from("attention_items")
    .upsert(
      {
        board_id: input.board_id,
        account_id: input.account_id,
        message_id: input.message_id,
        thread_id: input.thread_id ?? null,
        from_addr: input.from,
        subject: input.subject,
        snippet: input.snippet,
        summary: input.snippet,
        email_date: input.date ?? "",
        status: "filed",
      },
      { onConflict: "board_id,message_id" }
    )
    .select(ITEM_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as AttentionItem;
}

export async function listItems(): Promise<AttentionItem[]> {
  const { data, error } = await getAttentionDb()
    .from("attention_items")
    .select(ITEM_COLS)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AttentionItem[];
}

// Persist a board's card order: position = index in orderedIds. Scoped to the
// board so a stale id from another column can't clobber the wrong row.
export async function reorderItems(
  boardId: string,
  orderedIds: string[]
): Promise<void> {
  const db = getAttentionDb();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      db
        .from("attention_items")
        .update({ position: index })
        .eq("id", id)
        .eq("board_id", boardId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

// Update an item's status / priority / board in one call. Setting board_id also
// marks it filed (a move approves it).
export type ItemPatch = {
  status?: AttentionItemStatus;
  priority?: AttentionPriority | null;
  board_id?: string;
};

export async function updateItem(
  id: string,
  patch: ItemPatch
): Promise<AttentionItem> {
  const update: {
    status?: AttentionItemStatus;
    priority?: AttentionPriority | null;
    board_id?: string;
  } = {};
  if (patch.board_id) {
    update.board_id = patch.board_id;
    update.status = "filed";
  }
  if (patch.status) update.status = patch.status;
  if (patch.priority !== undefined) update.priority = patch.priority;

  const { data, error } = await getAttentionDb()
    .from("attention_items")
    .update(update)
    .eq("id", id)
    .select(ITEM_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as AttentionItem;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await getAttentionDb()
    .from("attention_items")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// Remove every item from a board (the header "Clear" action) and return the
// rows removed, so the caller can mark their emails read. Undo restores them
// via restoreItems.
export async function clearBoard(boardId: string): Promise<AttentionItem[]> {
  const { data, error } = await getAttentionDb()
    .from("attention_items")
    .delete()
    .eq("board_id", boardId)
    .select(ITEM_COLS);
  if (error) throw new Error(error.message);
  return (data ?? []) as AttentionItem[];
}

// Re-insert previously-removed items verbatim (their original ids/fields), so a
// cleared or dismissed batch can be undone.
export async function restoreItems(rows: AttentionItem[]): Promise<void> {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({
    id: r.id,
    board_id: r.board_id,
    account_id: r.account_id,
    message_id: r.message_id,
    thread_id: r.thread_id,
    from_addr: r.from_addr,
    subject: r.subject,
    snippet: r.snippet,
    summary: r.summary,
    email_date: r.email_date,
    status: r.status,
    priority: r.priority,
    position: r.position,
  }));
  const { error } = await getAttentionDb()
    .from("attention_items")
    .upsert(payload, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

// ---- Classification -----------------------------------------------------

export type ClassifyInput = {
  account_id?: string | null;
  message_id: string;
  thread_id?: string | null;
  from: string;
  subject: string;
  snippet: string;
  date?: string;
};

export type ClassifyOutcome = {
  board: AttentionBoard;
  item: AttentionItem;
  status: AttentionItemStatus;
  summary: string;
};

type ModelVerdict = {
  boardId: string | null;
  confidence: "high" | "low";
  summary: string;
};

async function askModel(
  input: ClassifyInput,
  boards: AttentionBoard[]
): Promise<ModelVerdict | null> {
  const boardLines = boards
    .map((b) => {
      const signals =
        b.sender_domains.length || b.keywords.length
          ? `\n  example signals — senders: ${
              b.sender_domains.join(", ") || "none"
            }; keywords: ${b.keywords.join(", ") || "none"}`
          : "";
      return `- id=${b.id}\n  name: ${b.name}\n  purpose: ${
        b.rules || "(no description provided)"
      }${signals}`;
    })
    .join("\n\n");

  return chatJson<ModelVerdict>([
    {
      role: "system",
      content:
        "You sort an email into one of the user's attention boards by " +
        "understanding what the email is ABOUT and matching it to the board " +
        "whose purpose best fits. Read each board's name and purpose (a " +
        "natural-language description) and use judgment about meaning and " +
        "intent — do NOT require a literal keyword or sender match. The listed " +
        "senders/keywords are only example signals that commonly appear, not " +
        "requirements; an email can belong to a board without containing any of " +
        "them. Pick the single best-fitting board. Return boardId null only " +
        "when the email genuinely relates to NONE of the boards (e.g. unrelated " +
        "marketing or newsletters). " +
        'Respond with JSON only: {"boardId": "<board id or null>", ' +
        '"confidence": "high" | "low", "summary": "<one short sentence>"}. ' +
        'Use "high" when a board clearly fits; "low" for a borderline fit or ' +
        "when two boards compete.",
    },
    {
      role: "user",
      content:
        `Boards:\n${boardLines}\n\n` +
        `Email:\nFrom: ${input.from}\nSubject: ${input.subject}\n` +
        `Preview: ${input.snippet}`,
    },
  ]);
}

// Ask the model to pick the board + confidence for one email and file it. The
// board's sender domains / keywords / rules are passed to the model as context,
// but the model alone decides: a "high" confidence verdict is filed; anything
// else is filed as needs_approval on the model's best guess.
async function classifyOne(
  boards: AttentionBoard[],
  input: ClassifyInput,
  opts?: { fileWhenNoMatch?: boolean }
): Promise<ClassifyOutcome | null> {
  // A deliberate drag files a best-guess for approval even on a weak match; a
  // bulk sweep leaves "fits no board" emails in the inbox instead of cluttering.
  const fileWhenNoMatch = opts?.fileWhenNoMatch ?? true;

  const verdict = await askModel(input, boards);

  // Batch mode: surface a model outage as an error (so it's retried/reported,
  // not silently counted as "no board fit").
  if (!verdict && !fileWhenNoMatch) {
    throw new Error("classifier unavailable");
  }

  const modelBoard = verdict?.boardId
    ? boards.find((b) => b.id === verdict.boardId) ?? null
    : null;

  if (!modelBoard && !fileWhenNoMatch) return null; // genuine "no board fits"

  const confident = !!modelBoard && verdict?.confidence === "high";
  const board = modelBoard ?? boards[0];

  const summary = (verdict?.summary || input.snippet || input.subject).trim();
  const status: AttentionItemStatus = confident ? "filed" : "needs_approval";

  const { data, error } = await getAttentionDb()
    .from("attention_items")
    .upsert(
      {
        board_id: board.id,
        account_id: input.account_id ?? null,
        message_id: input.message_id,
        thread_id: input.thread_id ?? null,
        from_addr: input.from,
        subject: input.subject,
        snippet: input.snippet,
        summary,
        email_date: input.date ?? "",
        status,
      },
      { onConflict: "board_id,message_id" }
    )
    .select(ITEM_COLS)
    .single();
  if (error) throw new Error(error.message);

  return { board, item: data as AttentionItem, status, summary };
}

// Classify + file a single dropped email. Returns null only when there are no
// boards to file into.
export async function classifyEmail(
  input: ClassifyInput
): Promise<ClassifyOutcome | null> {
  const boards = await listBoards();
  if (boards.length === 0) return null;
  return classifyOne(boards, input);
}

export type BatchClassifyResult = {
  total: number;
  filed: number;
  needsApproval: number;
  skipped: number; // already linked to a board
  unmatched: number; // fit no board — left in the inbox
  errored: number; // classifier was unavailable for these
};

// Classify many emails at once (e.g. the whole unread inbox). Fetches the
// boards once, skips emails already linked to a board, and runs the model in
// small concurrent batches to stay quick without hammering the API.
export async function classifyEmails(
  inputs: ClassifyInput[]
): Promise<BatchClassifyResult> {
  const total = inputs.length;
  const boards = await listBoards();
  if (boards.length === 0)
    return {
      total,
      filed: 0,
      needsApproval: 0,
      skipped: 0,
      unmatched: 0,
      errored: 0,
    };

  const already = new Set(await listFiledMessageIds());
  const todo = inputs.filter((i) => !already.has(i.message_id));
  const skipped = total - todo.length;

  let filed = 0;
  let needsApproval = 0;
  let unmatched = 0;
  let errored = 0;
  const CHUNK = 6;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const results = await Promise.all(
      todo.slice(i, i + CHUNK).map(async (input) => {
        try {
          return {
            ok: true as const,
            outcome: await classifyOne(boards, input, {
              fileWhenNoMatch: false,
            }),
          };
        } catch {
          return { ok: false as const, outcome: null };
        }
      })
    );
    for (const r of results) {
      if (!r.ok) errored++; // model was unavailable
      else if (r.outcome === null) unmatched++; // genuinely fit no board
      else if (r.outcome.status === "filed") filed++;
      else needsApproval++;
    }
  }

  return { total, filed, needsApproval, skipped, unmatched, errored };
}

// ---- Dismiss feedback -----------------------------------------------------

export type DismissFeedbackInput = {
  from: string;
  subject: string;
  snippet: string;
  summary?: string;
  reason: string;
  fromBoardId?: string | null;
};

export type DismissFeedbackResult = {
  action: "update_board" | "create_board" | "none";
  board: AttentionBoard | null;
  explanation: string;
};

type FeedbackVerdict = {
  action: "update_board" | "create_board" | "none";
  boardId?: string | null;
  name?: string;
  color?: string;
  rules?: string;
  keywords?: string[];
  senderDomains?: string[];
  explanation?: string;
};

// The user removed an email from the board it was filed onto and explained why.
// Use a cheap model to either revise an existing board's rules or create a new
// board so this kind of email is handled correctly next time.
export async function applyDismissFeedback(
  input: DismissFeedbackInput
): Promise<DismissFeedbackResult> {
  const boards = await listBoards();
  const boardLines = boards
    .map(
      (b) =>
        `- id=${b.id} | name=${b.name} | senders=[${b.sender_domains.join(
          ", "
        )}] | keywords=[${b.keywords.join(", ")}] | rules: ${b.rules}`
    )
    .join("\n");

  const verdict = await chatJson<FeedbackVerdict>([
    {
      role: "system",
      content:
        "The user removed an email from the attention board it was auto-filed " +
        "onto, because it didn't belong there. Using their reason, improve the " +
        "boards so this email is handled correctly next time. Choose ONE action:\n" +
        "- update_board: revise an EXISTING board's rules (and optionally its " +
        "keywords / sender_domains) so it matches this email. Provide the FULL " +
        "revised rules text, not a diff.\n" +
        "- create_board: propose a NEW board that fits this email (name, rules, " +
        "optional keywords, sender_domains, and a hex color).\n" +
        "- none: if no change is warranted.\n" +
        'Respond with JSON only: {"action":"update_board"|"create_board"|"none",' +
        '"boardId":"<id, for update>","name":"<for create>","color":"<#hex, for ' +
        'create>","rules":"<full rules text>","keywords":["..."],"senderDomains":' +
        '["..."],"explanation":"<one short sentence>"}.',
    },
    {
      role: "user",
      content:
        `Boards:\n${boardLines}\n\n` +
        `Email:\nFrom: ${input.from}\nSubject: ${input.subject}\n` +
        `Preview: ${input.snippet}\n` +
        (input.summary ? `Summary: ${input.summary}\n` : "") +
        `\nIt was removed from board id=${input.fromBoardId ?? "(unknown)"}.\n` +
        `User's reason: ${input.reason}`,
    },
  ]);

  if (!verdict || verdict.action === "none") {
    return {
      action: "none",
      board: null,
      explanation: verdict?.explanation ?? "No change made.",
    };
  }

  if (verdict.action === "update_board" && verdict.boardId) {
    const target = boards.find((b) => b.id === verdict.boardId);
    if (!target) {
      return { action: "none", board: null, explanation: "Board not found." };
    }
    const board = await updateBoard(verdict.boardId, {
      rules: verdict.rules ?? target.rules,
      keywords: verdict.keywords,
      sender_domains: verdict.senderDomains,
    });
    return {
      action: "update_board",
      board,
      explanation: verdict.explanation ?? `Updated “${board.name}” rules.`,
    };
  }

  if (verdict.action === "create_board" && verdict.name) {
    const board = await createBoard({
      name: verdict.name,
      color: verdict.color,
      rules: verdict.rules ?? "",
      keywords: verdict.keywords ?? [],
      sender_domains: verdict.senderDomains ?? [],
      position: boards.length,
    });
    return {
      action: "create_board",
      board,
      explanation: verdict.explanation ?? `Created “${board.name}”.`,
    };
  }

  return { action: "none", board: null, explanation: "No change made." };
}

// ---- Move feedback --------------------------------------------------------

export type MoveFeedbackInput = {
  from: string;
  subject: string;
  snippet: string;
  summary?: string;
  reason?: string;
  fromBoardId: string;
  toBoardId: string;
};

export type MoveFeedbackResult = {
  fromBoard: AttentionBoard | null;
  toBoard: AttentionBoard | null;
  explanation: string;
};

type BoardRuleEdit = {
  rules?: string;
  keywords?: string[];
  senderDomains?: string[];
};
type MoveVerdict = {
  from?: BoardRuleEdit;
  to?: BoardRuleEdit;
  explanation?: string;
};

// The user dragged an email from one board to another — it belongs on the
// destination, not the source. Tune BOTH boards: revise the source's rules to
// no longer match this kind of email, and the destination's to match it.
export async function applyMoveFeedback(
  input: MoveFeedbackInput
): Promise<MoveFeedbackResult> {
  const boards = await listBoards();
  const fromB = boards.find((b) => b.id === input.fromBoardId) ?? null;
  const toB = boards.find((b) => b.id === input.toBoardId) ?? null;
  if (!fromB || !toB) {
    return { fromBoard: null, toBoard: null, explanation: "Board not found." };
  }

  const describe = (b: AttentionBoard) =>
    `name=${b.name} | senders=[${b.sender_domains.join(
      ", "
    )}] | keywords=[${b.keywords.join(", ")}] | rules: ${b.rules}`;

  const verdict = await chatJson<MoveVerdict>([
    {
      role: "system",
      content:
        "The user moved an email from a SOURCE attention board to a " +
        "DESTINATION board, meaning it belongs on the destination, not the " +
        "source. Improve BOTH boards so emails like this sort correctly next " +
        "time: revise the SOURCE board's rules to no longer match this kind of " +
        "email, and the DESTINATION board's rules to match it. Keep rules as " +
        "concise natural language; you may also adjust each board's keywords " +
        "and sender_domains. Provide FULL revised rules text, not a diff. " +
        'Respond with JSON only: {"from":{"rules":"<source rules>","keywords":' +
        '["..."],"senderDomains":["..."]},"to":{"rules":"<destination rules>",' +
        '"keywords":["..."],"senderDomains":["..."]},"explanation":"<one short ' +
        'sentence>"}. Omit a field to leave it unchanged.',
    },
    {
      role: "user",
      content:
        `SOURCE board: ${describe(fromB)}\n` +
        `DESTINATION board: ${describe(toB)}\n\n` +
        `Email:\nFrom: ${input.from}\nSubject: ${input.subject}\n` +
        `Preview: ${input.snippet}\n` +
        (input.summary ? `Summary: ${input.summary}\n` : "") +
        (input.reason ? `\nUser's note: ${input.reason}` : ""),
    },
  ]);

  if (!verdict) {
    return { fromBoard: fromB, toBoard: toB, explanation: "No changes made." };
  }

  let fromBoard = fromB;
  let toBoard = toB;
  if (verdict.from && (verdict.from.rules !== undefined || verdict.from.keywords || verdict.from.senderDomains)) {
    fromBoard = await updateBoard(fromB.id, {
      rules: verdict.from.rules ?? fromB.rules,
      keywords: verdict.from.keywords,
      sender_domains: verdict.from.senderDomains,
    });
  }
  if (verdict.to && (verdict.to.rules !== undefined || verdict.to.keywords || verdict.to.senderDomains)) {
    toBoard = await updateBoard(toB.id, {
      rules: verdict.to.rules ?? toB.rules,
      keywords: verdict.to.keywords,
      sender_domains: verdict.to.senderDomains,
    });
  }

  return {
    fromBoard,
    toBoard,
    explanation:
      verdict.explanation ?? `Updated “${fromB.name}” and “${toB.name}”.`,
  };
}
