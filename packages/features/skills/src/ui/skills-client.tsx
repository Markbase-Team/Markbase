"use client";

import { ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { useNavigation } from "@markbase/ui/navigation";
import type {} from "./routes";
import type {} from "./routes";
import { Button } from "@markbase/ui/button";
import { cn } from "@markbase/ui/utils";
import { AppHeader, headerNoDrag } from "@markbase/ui/app-header";
import { useSkills } from "./use-skills";

export function SkillsClient() {
  const s = useSkills();
  const { push, Link, routes } = useNavigation();

  async function onNew() {
    const id = await s.addSkill();
    if (id) push(routes.skill(id));
  }

  return (
    <main className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="Skills">
        <Button
          onClick={onNew}
          disabled={s.adding}
          size="sm"
          className={cn("ml-auto shrink-0", headerNoDrag)}
        >
          {s.adding ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          New skill
        </Button>
      </AppHeader>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4">
        <p className="mb-4 text-sm text-muted-foreground">
          Claude Code skills hosted here. Agents pull them via the API and install
          them into their own skills directory.
        </p>
        {s.skills.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No skills yet. Click “New skill”, or let an agent publish one via the
            API.
          </p>
        ) : (
          s.skills.map((skill) => (
            <div
              key={skill.id}
              className="group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-foreground/20"
            >
              <Link
                href={routes.skill(skill.id)}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <code className="block truncate font-mono text-sm font-semibold">
                    {skill.name}
                  </code>
                  <p className="truncate text-xs text-muted-foreground">
                    {skill.description || "No description yet"}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
              <button
                type="button"
                onClick={() => s.remove(skill.id)}
                aria-label="Delete skill"
                title="Delete skill"
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
