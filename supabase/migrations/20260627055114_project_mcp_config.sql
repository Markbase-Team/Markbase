-- Per-project MCP "environment": the set of MCP servers Claude Code should use
-- when the worker runs this project's tickets. Stored as the standard
-- { "mcpServers": { … } } JSON, with credentials referenced as ${SECRET_NAME}
-- placeholders — the actual values live in the project's encrypted secrets and
-- are injected as env at run time (the config itself holds no secrets).
alter table public.projects
  add column if not exists mcp_config jsonb;
