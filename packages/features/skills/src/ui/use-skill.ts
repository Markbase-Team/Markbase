"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SaveStatus } from "./use-skills";

export type SingleSkill = {
  id: string;
  name: string;
  description: string;
  body: string;
  status: SaveStatus;
};

type SkillRow = { id: string; name: string; description: string; body: string };

const AUTOSAVE_MS = 700;

// Load one skill and autosave edits to its name/description/body (the SKILL.md).
// The bundled files are handled separately by useSkillFiles.
export function useSkill(skillId: string) {
  const [skill, setSkill] = useState<SingleSkill | null>(null);
  const draft = useRef({ name: "", description: "", body: "" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/skills/${skillId}`);
        const data: { skill?: SkillRow } = await res.json();
        if (!res.ok || !data.skill) return;
        draft.current = {
          name: data.skill.name,
          description: data.skill.description,
          body: data.skill.body,
        };
        setSkill({ ...data.skill, status: "idle" });
      } catch {
        // ignore
      }
    })();
    return () => clearTimeout(timer.current);
  }, [skillId]);

  async function flush() {
    setSkill((s) => (s ? { ...s, status: "saving" } : s));
    try {
      const res = await fetch(`/api/admin/skills/${skillId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft.current),
      });
      const data: { skill?: SkillRow; error?: string } = await res.json();
      if (!res.ok || !data.skill) throw new Error(data.error ?? "Failed");
      setSkill((s) => (s ? { ...s, status: "saved" } : s));
    } catch (err) {
      setSkill((s) => (s ? { ...s, status: "idle" } : s));
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  }

  function setField(
    patch: Partial<Pick<SingleSkill, "name" | "description" | "body">>
  ) {
    draft.current = { ...draft.current, ...patch };
    setSkill((s) => (s ? { ...s, ...patch, status: "saving" } : s));
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }

  return { skill, setField };
}
