"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type SaveStatus = "idle" | "saving" | "saved";

export type SkillView = {
  id: string;
  name: string;
  description: string;
  body: string;
  status: SaveStatus;
};

type SkillRow = { id: string; name: string; description: string; body: string };

const AUTOSAVE_MS = 700;

const toView = (s: SkillRow): SkillView => ({
  id: s.id,
  name: s.name,
  description: s.description,
  body: s.body,
  status: "idle",
});

// Pick the next free "new-skill-N" name so a fresh skill has a valid slug.
function nextName(existing: SkillView[]): string {
  const taken = new Set(existing.map((s) => s.name));
  if (!taken.has("new-skill")) return "new-skill";
  let i = 2;
  while (taken.has(`new-skill-${i}`)) i++;
  return `new-skill-${i}`;
}

// All Skills state + actions. Edits autosave (debounced). Mirrors useDiary.
export function useSkills() {
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [adding, setAdding] = useState(false);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const drafts = useRef<
    Record<string, { name: string; description: string; body: string }>
  >({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/skills");
        const data: { skills?: SkillRow[] } = await res.json();
        if (!res.ok) return;
        for (const s of data.skills ?? []) {
          drafts.current[s.id] = {
            name: s.name,
            description: s.description,
            body: s.body,
          };
        }
        setSkills((data.skills ?? []).map(toView));
      } catch {
        // ignore
      }
    })();
    // The ref is read HERE, while the effect is set up, not in the cleanup: by
    // cleanup time `timers.current` could be a different object than the one
    // this effect meant.
    const pending = timers.current;
    return () => {
      for (const t of Object.values(pending)) clearTimeout(t);
    };
  }, []);

  async function flush(id: string) {
    const draft = drafts.current[id];
    if (!draft) return;
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: "saving" } : s))
    );
    try {
      const res = await fetch(`/api/admin/skills/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data: { skill?: SkillRow; error?: string } = await res.json();
      if (!res.ok || !data.skill) throw new Error(data.error ?? "Failed");
      setSkills((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "saved" } : s))
      );
    } catch (err) {
      setSkills((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "idle" } : s))
      );
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  }

  function setField(
    id: string,
    patch: Partial<Pick<SkillView, "name" | "description" | "body">>
  ) {
    drafts.current[id] = { ...drafts.current[id], ...patch };
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch, status: "saving" } : s))
    );
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => flush(id), AUTOSAVE_MS);
  }

  async function addSkill(): Promise<string | undefined> {
    if (adding) return undefined;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nextName(skills) }),
      });
      const data: { skill?: SkillRow; error?: string } = await res.json();
      if (!res.ok || !data.skill) throw new Error(data.error ?? "Failed");
      drafts.current[data.skill.id] = {
        name: data.skill.name,
        description: data.skill.description,
        body: data.skill.body,
      };
      setSkills((prev) => [toView(data.skill!), ...prev]);
      return data.skill.id;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add skill");
      return undefined;
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    delete drafts.current[id];
    setSkills((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(`/api/admin/skills/${id}`, { method: "DELETE" });
    } catch {
      // best-effort
    }
  }

  return { skills, adding, addSkill, setField, remove };
}
