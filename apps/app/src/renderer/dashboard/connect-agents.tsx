import { useState } from "react";
import { Check, CircleAlert, Minus, Plug } from "lucide-react";
import type { McpInstallResult } from "@markbase/node/mcp-install";
import { Button } from "@markbase/ui/button";
import type { AgentsBridge } from "../../preload";

// Settings › Agents: give the agents on this Mac the document tools.
//
// An agent working in a mounted vault needs nothing — it edits the files. This
// is for the ones that are not on the disk: a chat in Claude Desktop, or an
// agent in another folder. One button runs the same installer as `markbase
// mcp install` (the docs MCP server, with this app's key) and says, agent by
// agent, what happened.

function ResultRow({ result }: { result: McpInstallResult }) {
  const Icon = result.status === "installed" ? Check : result.status === "skipped" ? Minus : CircleAlert;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon
        className={
          result.status === "installed"
            ? "size-4 shrink-0 text-emerald-600"
            : result.status === "failed"
              ? "size-4 shrink-0 text-destructive"
              : "size-4 shrink-0 text-muted-foreground"
        }
      />
      <span className="font-medium">{result.name}</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {result.status === "installed" ? "connected" : result.detail}
      </span>
    </li>
  );
}

export function ConnectAgents({ agents }: { agents: AgentsBridge }) {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<McpInstallResult[] | null>(null);

  async function connect() {
    setBusy(true);
    try {
      setResults(await agents.connectMcp());
    } finally {
      setBusy(false);
    }
  }

  const connected = results?.some((r) => r.status === "installed") ?? false;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Agents</h3>
      <p className="text-sm text-muted-foreground">
        Give Claude Desktop, Claude Code, Codex and Cursor the document tools (MCP): list, read, create and
        edit your documents, and comment on them.
      </p>
      <Button variant="outline" onClick={() => void connect()} disabled={busy} className="w-full justify-start">
        <Plug className="size-4" />
        {busy ? "Connecting…" : results ? "Connect again" : "Connect agents"}
      </Button>
      {results && results.length === 0 && (
        <p className="text-sm text-destructive">Sign in first, then connect.</p>
      )}
      {results && results.length > 0 && (
        <>
          <ul className="space-y-1.5 pt-1">
            {results.map((result) => (
              <ResultRow key={result.target} result={result} />
            ))}
          </ul>
          {connected && (
            <p className="text-xs text-muted-foreground">Restart an agent so it loads the tools.</p>
          )}
        </>
      )}
    </section>
  );
}
