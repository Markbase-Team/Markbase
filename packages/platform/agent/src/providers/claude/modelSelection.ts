// Minimal standalone extract of Claudian's toClaudeRuntimeModelId: strip the
// provider model-selection prefix ("claude-code/") if present, else pass through.

const CLAUDE_SELECTION_PREFIX = 'claude-code/';

export function toClaudeRuntimeModelId(modelId: string): string {
  return modelId.startsWith(CLAUDE_SELECTION_PREFIX)
    ? modelId.slice(CLAUDE_SELECTION_PREFIX.length)
    : modelId;
}
