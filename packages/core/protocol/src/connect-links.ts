// One-click ways to add the hosted MCP server (/mcp) to an agent. Each agent
// has its own: a link the app itself opens, or a command to paste. All of them
// end at the same sign-in in the browser; none carries a key.
//
// The server is named as the local install names it (`markbase-docs`), so
// connecting this way replaces a local entry instead of sitting beside it.

export const MCP_SERVER_NAME = "markbase-docs";

export type ConnectKind = "link" | "command" | "paste";

export interface ConnectOption {
  id: "claude" | "claude-code" | "codex" | "cursor" | "vscode";
  name: string;
  /** What kind of app it is, under the name. */
  caption: string;
  kind: ConnectKind;
  /** link: the address to open. paste: the page where the address is pasted. */
  href?: string;
  /** command: what to run. paste: the address to paste. Copied on click. */
  copy?: string;
  /** Said once the click has done its part. */
  after: string;
  /**
   * For a link: what to do when the app did not open. A page cannot tell
   * whether it did (the app is not installed, or the browser keeps app links
   * to itself, as some built-in browsers do), so this is shown every time.
   */
  fallback?: {
    /** The command, or the settings entry, that adds the server by hand. */
    text: string;
    /** Where that goes. */
    where: string;
    /** Where to get the app. */
    getApp: string;
  };
}

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** Cursor's install link: the server's mcp.json entry, base64, in `config`. */
export function cursorInstallLink(mcpUrl: string): string {
  const config = encodeURIComponent(base64(JSON.stringify({ url: mcpUrl })));
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${config}`;
}

/** VS Code's install link: the server as URL-encoded JSON after the `?`. */
export function vscodeInstallLink(mcpUrl: string): string {
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_SERVER_NAME, type: "http", url: mcpUrl }))}`;
}

/** VS Code's own command line adds a server too (`code --add-mcp`), for when the link does nothing. */
export function vscodeAddCommand(mcpUrl: string): string {
  return `code --add-mcp '${JSON.stringify({ name: MCP_SERVER_NAME, type: "http", url: mcpUrl })}'`;
}

/** The entry for Cursor's ~/.cursor/mcp.json, for when the link does nothing. */
export function cursorConfigEntry(mcpUrl: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { url: mcpUrl } } }, null, 2);
}

export function claudeCodeCommand(mcpUrl: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpUrl}`;
}

export function codexCommand(mcpUrl: string): string {
  return `codex mcp add ${MCP_SERVER_NAME} --url ${mcpUrl}`;
}

/** Where Claude's connectors are added. It has no link that adds one, so the address is pasted there. */
export const CLAUDE_CONNECTORS_URL = "https://claude.ai/settings/connectors";

export function connectOptions(mcpUrl: string): ConnectOption[] {
  return [
    {
      id: "claude",
      name: "Claude",
      caption: "Custom connector",
      kind: "paste",
      href: CLAUDE_CONNECTORS_URL,
      copy: mcpUrl,
      after: "Address copied. In Claude, choose Add custom connector and paste it.",
    },
    {
      id: "claude-code",
      name: "Claude Code",
      caption: "CLI",
      kind: "command",
      copy: claudeCodeCommand(mcpUrl),
      after: "Command copied. Run it in your terminal, then /mcp in Claude Code to sign in.",
    },
    {
      id: "codex",
      name: "Codex",
      caption: "CLI",
      kind: "command",
      copy: codexCommand(mcpUrl),
      after: `Command copied. Run it in your terminal, then: codex mcp login ${MCP_SERVER_NAME}`,
    },
    {
      id: "cursor",
      name: "Cursor",
      caption: "IDE",
      kind: "link",
      href: cursorInstallLink(mcpUrl),
      after: "Asked Cursor to add Markbase. Cursor should open and ask you to install it.",
      fallback: {
        text: cursorConfigEntry(mcpUrl),
        where: "Cursor did not open? Add this to ~/.cursor/mcp.json (or Cursor Settings, MCP), then sign in when Cursor asks.",
        getApp: "https://cursor.com/download",
      },
    },
    {
      id: "vscode",
      name: "VS Code",
      caption: "IDE",
      kind: "link",
      href: vscodeInstallLink(mcpUrl),
      after: "Asked VS Code to add Markbase. VS Code should open and ask you to install it.",
      fallback: {
        text: vscodeAddCommand(mcpUrl),
        where: "VS Code did not open? Run this in a terminal instead, then sign in when VS Code asks.",
        getApp: "https://code.visualstudio.com/download",
      },
    },
  ];
}
