"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useLatest } from "@markbase/ui/latest-ref";

export type SaveStatus = "idle" | "saving" | "saved";

export type WorkLog = {
  id: string;
  entry_date: string | null;
  title: string;
  content: string;
  status: SaveStatus;
};

export type ProjectDoc = {
  id: string;
  title: string;
  content: string;
  status: SaveStatus;
};

export type Secret = {
  id: string;
  name: string;
  description: string;
  preview: string;
  created_at: string;
  updated_at: string;
};

type WorkLogRow = {
  id: string;
  entry_date: string | null;
  title: string;
  content: string;
};
type DocRow = { id: string; title: string; content: string };
type SecretRow = Secret;

type ProjectContextValue = {
  slug: string;
  // Work logs
  workLogs: WorkLog[];
  workLogAdding: boolean;
  addWorkLog: () => Promise<string | undefined>;
  setWorkLogField: (
    id: string,
    patch: Partial<Pick<WorkLog, "entry_date" | "title" | "content">>
  ) => void;
  removeWorkLog: (id: string) => void;
  // Documentation
  docs: ProjectDoc[];
  docAdding: boolean;
  addDoc: () => Promise<string | undefined>;
  setDocField: (
    id: string,
    patch: Partial<Pick<ProjectDoc, "title" | "content">>
  ) => void;
  removeDoc: (id: string) => void;
  // Secrets
  secrets: Secret[];
  secretsLoading: boolean;
  addSecret: (input: {
    name: string;
    description: string;
    value: string;
  }) => Promise<boolean>;
  removeSecret: (id: string) => Promise<void>;
};

const Ctx = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProject must be used within <ProjectProvider>");
  return ctx;
}

const AUTOSAVE_MS = 700;
const isTemp = (id: string) => id.startsWith("temp-");

// Per-project client state (Work Logs + Secrets) with optimistic create/edit/
// delete, shared across the project's asset tabs so switching is instant.
export function ProjectProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  // ---- Work logs ---------------------------------------------------------
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [workLogAdding, setWorkLogAdding] = useState(false);
  const logBase = `/api/admin/projects/${encodeURIComponent(slug)}/work-logs`;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const drafts = useRef<
    Record<string, { entry_date: string | null; title: string; content: string }>
  >({});
  const tempSeq = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(logBase);
        const data: { logs?: WorkLogRow[] } = await res.json();
        if (!res.ok) return;
        for (const l of data.logs ?? []) {
          drafts.current[l.id] = {
            entry_date: l.entry_date,
            title: l.title,
            content: l.content,
          };
        }
        setWorkLogs((data.logs ?? []).map((l) => ({ ...l, status: "idle" })));
      } catch {
        // ignore
      }
    })();
    const t = timers.current;
    return () => {
      for (const x of Object.values(t)) clearTimeout(x);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const flushLog = useCallback(
    async (id: string) => {
      // Temp rows have no server id yet; the create swaps in the real id and
      // re-schedules a flush if needed.
      if (isTemp(id)) return;
      const draft = drafts.current[id];
      if (!draft) return;
      setWorkLogs((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status: "saving" } : l))
      );
      try {
        const res = await fetch(`${logBase}/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        const data: { log?: WorkLogRow; error?: string } = await res.json();
        if (!res.ok || !data.log) throw new Error(data.error ?? "Failed");
        setWorkLogs((prev) =>
          prev.map((l) => (l.id === id ? { ...l, status: "saved" } : l))
        );
      } catch (err) {
        setWorkLogs((prev) =>
          prev.map((l) => (l.id === id ? { ...l, status: "idle" } : l))
        );
        toast.error(err instanceof Error ? err.message : "Couldn't save log");
      }
    },
    [logBase]
  );

  const setWorkLogField = useCallback(
    (
      id: string,
      patch: Partial<Pick<WorkLog, "entry_date" | "title" | "content">>
    ) => {
      drafts.current[id] = { ...drafts.current[id], ...patch };
      setWorkLogs((prev) =>
        prev.map((l) => (l.id === id ? { ...l, ...patch, status: "saving" } : l))
      );
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => flushLog(id), AUTOSAVE_MS);
    },
    [flushLog]
  );

  const addWorkLog = useCallback(async () => {
    if (workLogAdding) return;
    setWorkLogAdding(true);
    // Optimistic: show the new (empty, undated) log immediately.
    const tempId = `temp-${++tempSeq.current}`;
    drafts.current[tempId] = { entry_date: null, title: "", content: "" };
    setWorkLogs((prev) => [
      { id: tempId, entry_date: null, title: "", content: "", status: "saving" },
      ...prev,
    ]);
    try {
      const res = await fetch(logBase, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entry_date: null, title: "", content: "" }),
      });
      const data: { log?: WorkLogRow; error?: string } = await res.json();
      if (!res.ok || !data.log) throw new Error(data.error ?? "Failed");
      const realId = data.log.id;
      // Carry over any edits made while the create was in flight.
      const pending = drafts.current[tempId];
      drafts.current[realId] = pending;
      delete drafts.current[tempId];
      const dirty =
        pending.title !== "" || pending.content !== "" || pending.entry_date !== null;
      setWorkLogs((prev) =>
        prev.map((l) =>
          l.id === tempId ? { ...l, id: realId, status: dirty ? "saving" : "saved" } : l
        )
      );
      if (dirty) flushLog(realId);
      return realId;
    } catch (err) {
      delete drafts.current[tempId];
      setWorkLogs((prev) => prev.filter((l) => l.id !== tempId));
      toast.error(err instanceof Error ? err.message : "Couldn't add log");
    } finally {
      setWorkLogAdding(false);
    }
  }, [workLogAdding, logBase, flushLog]);

  const removeWorkLog = useCallback(
    (id: string) => {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
      delete drafts.current[id];
      setWorkLogs((prev) => prev.filter((l) => l.id !== id));
      if (isTemp(id)) return;
      fetch(`${logBase}/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [logBase]
  );

  // ---- Documentation -----------------------------------------------------
  // Same optimistic + debounced-autosave pattern as work logs; docs hold
  // title + content and append in creation order.
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [docAdding, setDocAdding] = useState(false);
  const docBase = `/api/admin/projects/${encodeURIComponent(slug)}/docs`;
  const docTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const docDrafts = useRef<Record<string, { title: string; content: string }>>({});
  const docTempSeq = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(docBase);
        const data: { docs?: DocRow[] } = await res.json();
        if (!res.ok) return;
        for (const d of data.docs ?? []) {
          docDrafts.current[d.id] = { title: d.title, content: d.content };
        }
        setDocs((data.docs ?? []).map((d) => ({ ...d, status: "idle" })));
      } catch {
        // ignore
      }
    })();
    const t = docTimers.current;
    return () => {
      for (const x of Object.values(t)) clearTimeout(x);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const flushDoc = useCallback(
    async (id: string) => {
      if (isTemp(id)) return;
      const draft = docDrafts.current[id];
      if (!draft) return;
      setDocs((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: "saving" } : d))
      );
      try {
        const res = await fetch(`${docBase}/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        const data: { doc?: DocRow; error?: string } = await res.json();
        if (!res.ok || !data.doc) throw new Error(data.error ?? "Failed");
        setDocs((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: "saved" } : d))
        );
      } catch (err) {
        setDocs((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: "idle" } : d))
        );
        toast.error(err instanceof Error ? err.message : "Couldn't save doc");
      }
    },
    [docBase]
  );

  const setDocField = useCallback(
    (id: string, patch: Partial<Pick<ProjectDoc, "title" | "content">>) => {
      docDrafts.current[id] = { ...docDrafts.current[id], ...patch };
      setDocs((prev) =>
        prev.map((d) => (d.id === id ? { ...d, ...patch, status: "saving" } : d))
      );
      clearTimeout(docTimers.current[id]);
      docTimers.current[id] = setTimeout(() => flushDoc(id), AUTOSAVE_MS);
    },
    [flushDoc]
  );

  const addDoc = useCallback(async () => {
    if (docAdding) return;
    setDocAdding(true);
    const tempId = `temp-${++docTempSeq.current}`;
    docDrafts.current[tempId] = { title: "", content: "" };
    setDocs((prev) => [
      ...prev,
      { id: tempId, title: "", content: "", status: "saving" },
    ]);
    try {
      const res = await fetch(docBase, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "", content: "" }),
      });
      const data: { doc?: DocRow; error?: string } = await res.json();
      if (!res.ok || !data.doc) throw new Error(data.error ?? "Failed");
      const realId = data.doc.id;
      const pending = docDrafts.current[tempId];
      docDrafts.current[realId] = pending;
      delete docDrafts.current[tempId];
      const dirty = pending.title !== "" || pending.content !== "";
      setDocs((prev) =>
        prev.map((d) =>
          d.id === tempId
            ? { ...d, id: realId, status: dirty ? "saving" : "saved" }
            : d
        )
      );
      if (dirty) flushDoc(realId);
      return realId;
    } catch (err) {
      delete docDrafts.current[tempId];
      setDocs((prev) => prev.filter((d) => d.id !== tempId));
      toast.error(err instanceof Error ? err.message : "Couldn't add doc");
    } finally {
      setDocAdding(false);
    }
  }, [docAdding, docBase, flushDoc]);

  const removeDoc = useCallback(
    (id: string) => {
      clearTimeout(docTimers.current[id]);
      delete docTimers.current[id];
      delete docDrafts.current[id];
      setDocs((prev) => prev.filter((d) => d.id !== id));
      if (isTemp(id)) return;
      fetch(`${docBase}/${id}`, { method: "DELETE" }).catch(() => {});
    },
    [docBase]
  );

  // ---- Secrets -----------------------------------------------------------
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [secretsLoading, setSecretsLoading] = useState(true);
  // Latest secrets for rollback without re-creating removeSecret each change.
  const secretsRef = useLatest(secrets);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Inside the async body: a setState reached synchronously from an effect
      // costs a render pass before anything paints.
      setSecretsLoading(true);
      try {
        const res = await fetch(
          `/api/admin/secrets?project=${encodeURIComponent(slug)}`
        );
        const data: { secrets?: SecretRow[] } = await res.json();
        if (!res.ok) throw new Error();
        if (!cancelled) setSecrets(data.secrets ?? []);
      } catch {
        if (!cancelled) toast.error("Couldn't load secrets");
      } finally {
        if (!cancelled) setSecretsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const addSecret = useCallback(
    async (input: { name: string; description: string; value: string }) => {
      try {
        const res = await fetch("/api/admin/secrets", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ project: slug, ...input }),
        });
        const data: { secret?: Secret; error?: string } = await res.json();
        if (!res.ok || !data.secret) throw new Error(data.error ?? "Failed");
        setSecrets((s) =>
          [...s, data.secret!].sort((a, b) => a.name.localeCompare(b.name))
        );
        toast.success(`Saved ${data.secret.name}`);
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save secret");
        return false;
      }
    },
    [slug]
  );

  const removeSecret = useCallback(async (id: string) => {
    const prev = secretsRef.current;
    setSecrets((s) => s.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/admin/secrets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setSecrets(prev);
      toast.error("Couldn't delete secret");
    }
  }, [secretsRef]);

  return (
    <Ctx.Provider
      value={{
        slug,
        workLogs,
        workLogAdding,
        addWorkLog,
        setWorkLogField,
        removeWorkLog,
        docs,
        docAdding,
        addDoc,
        setDocField,
        removeDoc,
        secrets,
        secretsLoading,
        addSecret,
        removeSecret,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
