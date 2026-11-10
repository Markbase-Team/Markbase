import type { query as claudeAgentQuery } from '@anthropic-ai/claude-agent-sdk';

let queryPromise: Promise<typeof claudeAgentQuery> | undefined;

/**
 * Load the Agent SDK's `query`. A DYNAMIC import so the ESM-only SDK loads from a
 * CJS/bundled context (the Electron main process is bundled to CJS): the bundler
 * keeps the SDK external, so this stays a runtime `import()` rather than a
 * `require()` (which throws on an ESM-only package).
 */
export function loadClaudeAgentQuery(): Promise<typeof claudeAgentQuery> {
  queryPromise ??= import('@anthropic-ai/claude-agent-sdk').then((m) => m.query);
  return queryPromise;
}
