// A connection's capability is the ceiling on what any agent using it can do
// to your documents. It is THE security boundary: nothing an agent sends can
// widen it. Picked when a key is approved (the CLI's sign-in, an MCP client's)
// and changed later under API keys.
export const CAPABILITIES = ["viewer", "commenter", "editor", "owner"] as const;
export type Capability = (typeof CAPABILITIES)[number];
// Least-privilege sane default: co-write docs, but not share or delete them.
export const DEFAULT_CAPABILITY: Capability = "editor";

export const CAPABILITY_HELP: Record<Capability, string> = {
  viewer: "Viewer — read only",
  commenter: "Commenter — read and comment",
  editor: "Editor — read and edit documents",
  owner: "Owner — full access, including share and delete",
};

/** The capability a form sent, or the default when it sent none we know. */
export function pickedCapability(value: FormDataEntryValue | string | null | undefined): Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value)
    ? (value as Capability)
    : DEFAULT_CAPABILITY;
}
