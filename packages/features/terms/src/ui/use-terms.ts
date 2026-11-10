"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@markbase/protocol/api-client";

// Every call goes through the shared client, so this hook works unchanged in a
// browser tab (cookie) and in the desktop app's local page (bearer key). It
// names paths and nothing else — no origin, no credential, no `typeof window`.
const BASE = "/api/v1/terms";

export type QA = { id: string; q: string; a: string };

export type TermView = {
  id: string;
  term: string;
  definition: string;
  draft: string;
  expanded: boolean;
  asking: boolean;
  qa: QA[];
};

type TermRow = {
  id: string;
  term: string;
  definition: string;
  messages: { id: string; question: string; answer: string }[];
};

// All Terms state + actions. The component is a thin view over this hook.
export function useTerms() {
  const [terms, setTerms] = useState<TermView[]>([]);
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.json<{ terms?: TermRow[] }>(BASE);
        setTerms(
          (data.terms ?? []).map((t) => ({
            id: t.id,
            term: t.term,
            definition: t.definition,
            draft: "",
            expanded: false,
            asking: false,
            qa: t.messages.map((m) => ({
              id: m.id,
              q: m.question,
              a: m.answer,
            })),
          }))
        );
      } catch {
        // ignore — empty list
      }
    })();
  }, []);

  // Add a term: define it with the LLM, then show it (expanded) at the top.
  async function addTerm() {
    const term = input.trim();
    if (!term || adding) return;
    setAdding(true);
    try {
      const data = await api.json<{ term?: TermRow }>(BASE, {
        method: "POST",
        body: JSON.stringify({ term }),
      });
      if (!data.term) throw new Error("Failed");
      setTerms((prev) => [
        {
          id: data.term!.id,
          term: data.term!.term,
          definition: data.term!.definition,
          draft: "",
          expanded: true,
          asking: false,
          qa: [],
        },
        ...prev.map((t) => ({ ...t, expanded: false })),
      ]);
      setInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add term");
    } finally {
      setAdding(false);
    }
  }

  function toggleExpand(id: string) {
    setTerms((prev) =>
      prev.map((t) => (t.id === id ? { ...t, expanded: !t.expanded } : t))
    );
  }

  function setDraft(id: string, draft: string) {
    setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, draft } : t)));
  }

  async function remove(id: string) {
    setTerms((prev) => prev.filter((t) => t.id !== id));
    try {
      await api.request(`${BASE}/${id}`, { method: "DELETE" });
    } catch {
      // best-effort
    }
  }

  // Delete a single Q&A message from a term's thread.
  async function deleteMessage(termId: string, messageId: string) {
    setTerms((prev) =>
      prev.map((t) =>
        t.id === termId
          ? { ...t, qa: t.qa.filter((q) => q.id !== messageId) }
          : t
      )
    );
    try {
      await api.request(`${BASE}/messages/${messageId}`, { method: "DELETE" });
    } catch {
      // best-effort
    }
  }

  async function ask(t: TermView) {
    const question = t.draft.trim();
    if (!question || t.asking) return;
    setTerms((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, asking: true } : x))
    );
    try {
      const data = await api.json<{ answer?: string; messageId?: string }>(
        `${BASE}/${t.id}/ask`,
        { method: "POST", body: JSON.stringify({ question }) }
      );
      if (!data.answer) throw new Error("Failed");
      setTerms((prev) =>
        prev.map((x) =>
          x.id === t.id
            ? {
                ...x,
                asking: false,
                draft: "",
                qa: [
                  ...x.qa,
                  {
                    id: data.messageId ?? crypto.randomUUID(),
                    q: question,
                    a: data.answer!,
                  },
                ],
              }
            : x
        )
      );
    } catch (err) {
      setTerms((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, asking: false } : x))
      );
      toast.error(err instanceof Error ? err.message : "Couldn't ask");
    }
  }

  return {
    terms,
    input,
    adding,
    setInput,
    addTerm,
    toggleExpand,
    setDraft,
    remove,
    ask,
    deleteMessage,
  };
}
