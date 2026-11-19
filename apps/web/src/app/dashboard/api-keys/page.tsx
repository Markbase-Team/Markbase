import { instanceUrl } from "@/lib/instance-url";
import { ApiKeysClient } from "./api-keys-client";

export default async function ApiKeysPage() {
  // This instance's hosted MCP address, for the connect buttons.
  return <ApiKeysClient mcpUrl={`${await instanceUrl()}/mcp`} />;
}
