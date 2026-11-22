// A caller's role on one document. Authorization is per-doc and
// capability-based, not a global role. The type lives here because an endpoint
// description names the role it needs (endpoints.ts) and that description is
// read by the browser, the CLI and the MCP server; the rules that resolve and
// compare capabilities are the docs feature's, in its server/auth.ts.

export type Capability = "owner" | "editor" | "commenter" | "viewer";
