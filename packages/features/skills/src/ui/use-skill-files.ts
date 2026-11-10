"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { SaveStatus } from "./use-skills";

export type SkillFileView = {
  id: string;
  path: string;
  content: string;
  executable: boolean;
  status: SaveStatus;
};

type SkillFileRow = {
  id: string;
  path: string;
  content: string;
  executable: boolean;
};

const AUTOSAVE_MS = 700;

const toView = (f: SkillFileRow): SkillFileView => ({ ...f, status: "idle" });

// Suggest the next free "scripts/new-file-N.md" path for an added file.
function nextPath(existing: SkillFileView[]): string {
  const taken = new Set(existing.map((f) => f.path));
  const base = "scripts/new-file";
  if (!taken.has(`${base}.sh`)) return `${base}.sh`;
  let i = 2;
  while (taken.has(`${base}-${i}.sh`)) i++;
  return `${base}-${i}.sh`;
}

// A skill's bundled files (scripts/, references/, assets/). Lazily loaded per
// card; edits autosave (debounced), mirroring useSkills.
export function useSkillFiles(skillId: string) {
  const [files, setFiles] = useState<SkillFileView[]>([]);
  const [adding, setAdding] = useState(false);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const drafts = useRef<
    Record<string, { path: string; content: string; executable: boolean }>
  >({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/skills/${skillId}/files`);
        const data: { files?: SkillFileRow[] } = await res.json();
        if (!res.ok) return;
        for (const f of data.files ?? []) {
          drafts.current[f.id] = {
            path: f.path,
            content: f.content,
            executable: f.executable,
          };
        }
        setFiles((data.files ?? []).map(toView));
      } catch {
        // ignore
      }
    })();
    const t = timers.current;
    return () => {
      for (const x of Object.values(t)) clearTimeout(x);
    };
  }, [skillId]);

  async function flush(fileId: string) {
    const draft = drafts.current[fileId];
    if (!draft) return;
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, status: "saving" } : f))
    );
    try {
      const res = await fetch(`/api/admin/skills/${skillId}/files/${fileId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data: { file?: SkillFileRow; error?: string } = await res.json();
      if (!res.ok || !data.file) throw new Error(data.error ?? "Failed");
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, status: "saved" } : f))
      );
    } catch (err) {
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, status: "idle" } : f))
      );
      toast.error(err instanceof Error ? err.message : "Couldn't save file");
    }
  }

  function setField(
    fileId: string,
    patch: Partial<Pick<SkillFileView, "path" | "content" | "executable">>
  ) {
    drafts.current[fileId] = { ...drafts.current[fileId], ...patch };
    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, ...patch, status: "saving" } : f
      )
    );
    clearTimeout(timers.current[fileId]);
    timers.current[fileId] = setTimeout(() => flush(fileId), AUTOSAVE_MS);
  }

  async function addFile(): Promise<string | undefined> {
    if (adding) return undefined;
    setAdding(true);
    try {
      const path = nextPath(files);
      const res = await fetch(`/api/admin/skills/${skillId}/files`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, executable: path.endsWith(".sh") }),
      });
      const data: { file?: SkillFileRow; error?: string } = await res.json();
      if (!res.ok || !data.file) throw new Error(data.error ?? "Failed");
      drafts.current[data.file.id] = {
        path: data.file.path,
        content: data.file.content,
        executable: data.file.executable,
      };
      setFiles((prev) => [...prev, toView(data.file!)]);
      return data.file.id;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add file");
      return undefined;
    } finally {
      setAdding(false);
    }
  }

  async function remove(fileId: string) {
    clearTimeout(timers.current[fileId]);
    delete timers.current[fileId];
    delete drafts.current[fileId];
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    try {
      await fetch(`/api/admin/skills/${skillId}/files/${fileId}`, {
        method: "DELETE",
      });
    } catch {
      // best-effort
    }
  }

  return { files, adding, addFile, setField, remove };
}
