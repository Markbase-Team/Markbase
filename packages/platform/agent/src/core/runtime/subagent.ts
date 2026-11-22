// Extracted from Claudian's core/runtime/types.ts — the one runtime type the
// message-transform pipeline needs, without dragging its obsidian-coupled deps.

export interface AsyncSubagentCompletion {
  type: 'async_subagent_completion';
  providerSessionId: string;
  taskId: string;
  toolUseId?: string;
  status: 'completed' | 'error';
  result?: string;
}
