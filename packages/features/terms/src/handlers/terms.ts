import { chatJson } from "@markbase/llm";
import {
  addTermMessage,
  createTerm,
  deleteTerm,
  deleteTermMessage,
  getTerm,
  listTerms,
} from "../server";

// The glossary's endpoints. Plain `Request` in, plain `Response` out.
//
// Nothing here resolves a caller, and nothing here is injected. Authentication
// happens once, in the shell's proxy, before a request reaches this file — so
// these functions hold the feature and nothing else. A handler that reached the
// database for an unauthenticated caller would be a routing bug, not a missing
// check, and it is caught where routing is configured.
//
// There is also only ONE surface now. The app used to call /api/admin/terms and
// agents /api/v1/terms, for no reason other than that the two authenticated
// differently — the split encoded the gate, and the gate has moved. What the
// two really differed on was shape, and merging widened both additively: the
// agent's rows now carry their Q&A thread, and the app may supply a definition
// instead of paying for one.

async function readBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

const DEFINE_SYSTEM =
  "You are a glossary assistant. Define the given term clearly and " +
  "concisely in GitHub-flavored markdown (a short paragraph, plus a " +
  'brief example if helpful). Respond as JSON: {"definition":"<markdown>"}.';

/** Ask the model for a definition. Returns "" when it cannot — never throws. */
async function define(term: string): Promise<string> {
  try {
    const result = await chatJson<{ definition?: string }>([
      { role: "system", content: DEFINE_SYSTEM },
      { role: "user", content: `Term: ${term}` },
    ]);
    return result?.definition?.trim() ?? "";
  } catch {
    // Save the term anyway; the user can still chat to get a definition.
    return "";
  }
}

export const termsHandler = {
  // GET — saved terms (newest first) with their Q&A threads.
  GET: async (): Promise<Response> =>
    Response.json({ terms: await listTerms() }),

  // POST { term, definition? } — save a term. With no definition supplied, one
  // is generated with the LLM.
  POST: async (req: Request): Promise<Response> => {
    const body = await readBody<{ term?: string; definition?: string }>(req);
    if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
    const term = typeof body.term === "string" ? body.term.trim() : "";
    if (!term) {
      return Response.json({ error: "term is required" }, { status: 400 });
    }
    const supplied =
      typeof body.definition === "string" ? body.definition.trim() : "";
    const created = await createTerm({
      term,
      definition: supplied || (await define(term)),
    });
    return Response.json({ term: created }, { status: 201 });
  },
};

export const termHandler = {
  // DELETE — remove a term (its messages cascade).
  DELETE: async (_req: Request, id: string): Promise<Response> => {
    await deleteTerm(id);
    return Response.json({ ok: true });
  },
};

const ASK_SYSTEM =
  "You are a knowledgeable tutor helping the user understand a term in " +
  "depth. The term and its definition are only context for the topic — " +
  "NOT a limit on what you may discuss. Answer the user's question " +
  "directly and fully from your own knowledge, even when it goes beyond " +
  "the definition. Never refuse or hedge that something is 'outside the " +
  "scope of the definition.' Be concise and use GitHub-flavored " +
  'markdown. Respond as JSON: {"answer":"<markdown>"}.';

export const termAskHandler = {
  // POST { question } — follow-up about a term; the term and its definition
  // are the context. Persists the Q&A under the term.
  POST: async (req: Request, id: string): Promise<Response> => {
    const term = await getTerm(id);
    if (!term) {
      return Response.json({ error: "Term not found" }, { status: 404 });
    }

    const body = await readBody<{ question?: string }>(req);
    if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return Response.json({ error: "question is required" }, { status: 400 });
    }

    try {
      const result = await chatJson<{ answer?: string }>([
        { role: "system", content: ASK_SYSTEM },
        {
          role: "user",
          content: `The user is studying the term "${term.term}"${
            term.definition ? ` (working definition: ${term.definition})` : ""
          }.\n\nQuestion: ${question}`,
        },
      ]);
      const answer = result?.answer?.trim();
      if (!answer) {
        return Response.json(
          { error: "The model is unavailable right now" },
          { status: 503 }
        );
      }
      let messageId: string | undefined;
      try {
        messageId = (await addTermMessage({ term_id: id, question, answer })).id;
      } catch {
        // Non-fatal: still return the answer.
      }
      return Response.json({ answer, messageId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to ask";
      return Response.json({ error: message }, { status: 500 });
    }
  },
};

export const termMessageHandler = {
  // DELETE — remove one Q&A message.
  DELETE: async (_req: Request, id: string): Promise<Response> => {
    await deleteTermMessage(id);
    return Response.json({ ok: true });
  },
};
