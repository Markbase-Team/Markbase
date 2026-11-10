"use client";

import { useState } from "react";
import { useNavigation } from "@markbase/ui/navigation";
import type {} from "./routes";
import type {} from "./routes";
import { ArrowLeft, Check, FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { MarkdownEditor } from "@markbase/ui/markdown-editor";
import { CodeEditor } from "./code-editor";
import { FileTree, SKILL_MD_ID, type FileEntry } from "./file-tree";
import { useSkill, type SingleSkill } from "./use-skill";
import { useSkillFiles, type SkillFileView } from "./use-skill-files";
import type { SaveStatus } from "./use-skills";

// A Bolt/Lovable-style file explorer for one skill: a file tree on the left
// (SKILL.md + the bundled scripts/references/assets), an editor on the right.
// Markdown files open in the WYSIWYG editor; everything else opens in
// CodeMirror. Edits autosave.
export function SkillWorkspace({ skillId }: { skillId: string }) {
  const { Link, routes } = useNavigation();
  const { skill, setField } = useSkill(skillId);
  const f = useSkillFiles(skillId);
  const [selectedId, setSelectedId] = useState<string>(SKILL_MD_ID);

  const entries: FileEntry[] = [
    { id: SKILL_MD_ID, path: "SKILL.md", dirty: skill?.status === "saving" },
    ...f.files.map((file) => ({
      id: file.id,
      path: file.path,
      dirty: file.status === "saving",
    })),
  ];

  const selectedFile = f.files.find((x) => x.id === selectedId);

  async function onAddFile() {
    const id = await f.addFile();
    if (id) setSelectedId(id);
  }

  function onDelete(id: string) {
    f.remove(id);
    if (id === selectedId) setSelectedId(SKILL_MD_ID);
  }

  return (
    <main className="flex h-svh w-full min-w-0 flex-col px-3 py-3">
      <div className="flex shrink-0 items-center gap-3 pb-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={routes.skills()}>
            <ArrowLeft className="size-4" />
            Skills
          </Link>
        </Button>
        <code className="font-mono text-sm font-semibold">
          {skill?.name ?? "…"}
        </code>
        <SaveDot status={skill?.status} />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
        {/* File tree */}
        <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/20">
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground">
              FILES
            </span>
            <button
              type="button"
              onClick={onAddFile}
              disabled={f.adding}
              aria-label="Add file"
              title="Add file"
              className="text-muted-foreground hover:text-foreground"
            >
              {f.adding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FilePlus2 className="size-4" />
              )}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FileTree
              entries={entries}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDelete={onDelete}
            />
          </div>
        </aside>

        {/* Editor */}
        <section className="flex min-w-0 flex-1 flex-col">
          {selectedId === SKILL_MD_ID ? (
            <SkillMdPane skill={skill} setField={setField} />
          ) : selectedFile ? (
            <FilePane
              key={selectedFile.id}
              file={selectedFile}
              onField={(patch) => f.setField(selectedFile.id, patch)}
            />
          ) : (
            <div className="p-6 text-sm text-muted-foreground">
              Select a file.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SaveDot({ status }: { status?: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  return null;
}

function SkillMdPane({
  skill,
  setField,
}: {
  skill: SingleSkill | null;
  setField: (
    patch: Partial<Pick<SingleSkill, "name" | "description" | "body">>
  ) => void;
}) {
  if (!skill) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-4 py-2 font-mono text-xs text-muted-foreground">
        SKILL.md
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            value={skill.name}
            onChange={(e) => setField({ name: e.target.value })}
            placeholder="my-skill"
            className="font-mono text-sm"
            aria-label="Skill name"
          />
          <Input
            value={skill.description}
            onChange={(e) => setField({ description: e.target.value })}
            placeholder="One line: what it does + when to use it"
            aria-label="Description"
          />
        </div>
        <MarkdownEditor
          value={skill.body}
          onChange={(next) => setField({ body: next })}
          placeholder="# How this skill works…"
          imagePrefix="skills"
        />
      </div>
    </div>
  );
}

function FilePane({
  file,
  onField,
}: {
  file: SkillFileView;
  onField: (
    patch: Partial<Pick<SkillFileView, "path" | "content" | "executable">>
  ) => void;
}) {
  const isMarkdown = file.path.toLowerCase().endsWith(".md");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Input
          value={file.path}
          onChange={(e) => onField({ path: e.target.value })}
          aria-label="File path"
          className="h-7 flex-1 font-mono text-xs"
        />
        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={file.executable}
            onChange={(e) => onField({ executable: e.target.checked })}
            className="size-3.5 accent-current"
          />
          +x
        </label>
        <SaveDot status={file.status} />
      </div>
      {isMarkdown ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <MarkdownEditor
            value={file.content}
            onChange={(next) => onField({ content: next })}
            imagePrefix="skills"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeEditor
            value={file.content}
            onChange={(next) => onField({ content: next })}
            path={file.path}
          />
        </div>
      )}
    </div>
  );
}
