"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNavigation } from "@markbase/ui/navigation";
import type {} from "./routes";
import { Check, Loader2, Save, TriangleAlert } from "lucide-react";
import { Button } from "@markbase/ui/button";
import { Textarea } from "@markbase/ui/textarea";
import type { McpConfig } from "@markbase/protocol/types";
import { useProject } from "./project-context";

const TEMPLATE = `{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase", "--project-ref=YOUR_PROJECT_REF"],
      "env": { "SUPABASE_ACCESS_TOKEN": "\${SUPABASE_ACCESS_TOKEN}" }
    }
  }
}`;

export function McpClient() {
  const { Link, routes } = useNavigation();
  const { slug } = useProject();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  // Names of secrets that exist for this project, so we can show which ${refs}
  // are set vs. still missing.
  const [secretNames, setSecretNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/projects/${encodeURIComponent(slug)}/mcp`)
      .then((r) => r.json())
      .then((d: { mcp_config?: McpConfig | null }) => {
        if (cancelled) return;
        setText(d.mcp_config ? JSON.stringify(d.mcp_config, null, 2) : "");
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/secrets?project=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d: { secrets?: { name: string }[] }) => {
        if (!cancelled) setSecretNames((d.secrets ?? []).map((s) => s.name));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const secretsHref = routes.projectTab(slug, "secrets");

  // The ${NAME} references in the current config — these must exist as secrets.
  const refs = useMemo(
    () =>
      Array.from(
        new Set(
          [...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1])
        )
      ),
    [text]
  );

  async function save() {
    const trimmed = text.trim();
    let parsed: McpConfig | null = null;
    if (trimmed) {
      try {
        parsed = JSON.parse(trimmed) as McpConfig;
      } catch {
        toast.error("Invalid JSON — fix it and try again.");
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/projects/${encodeURIComponent(slug)}/mcp`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mcp_config: trimmed ? parsed : null }),
        }
      );
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      toast.success("MCP config saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">MCP servers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The MCP servers Claude Code uses when running this project&apos;s
            tickets. Reference credentials as{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              ${"{NAME}"}
            </code>{" "}
            — store the values in the{" "}
            <Link href={secretsHref} className="underline underline-offset-2">
              Secrets
            </Link>{" "}
            tab; they&apos;re injected at run time and never stored here.
          </p>
        </div>
        <Button onClick={save} disabled={saving || !loaded} className="shrink-0">
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save
        </Button>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={TEMPLATE}
        spellCheck={false}
        className="mt-4 min-h-[340px] font-mono text-xs"
        aria-label="MCP config JSON"
      />

      {refs.length > 0 && (
        <div className="mt-3 text-xs text-muted-foreground">
          <span>Referenced secrets — click to set in the Secrets tab:</span>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {refs.map((r) => {
              const isSet = secretNames.includes(r);
              return (
                <li key={r}>
                  <Link
                    href={secretsHref}
                    title={isSet ? "Set — edit in Secrets" : "Not set — add in Secrets"}
                    className="inline-flex items-center gap-1 rounded border px-2 py-1 transition-colors hover:bg-muted"
                  >
                    <code>{r}</code>
                    {isSet ? (
                      <Check className="size-3 text-emerald-600" />
                    ) : (
                      <TriangleAlert className="size-3 text-amber-600" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
