// A connection's capability is the ceiling on what any agent using it can do
// to your documents. It is THE security boundary: nothing an agent sends can
// widen it. Picked when a key is approved (the CLI's sign-in, an MCP client's)
// and changed later under API keys.
export const CAPABILITIES = ["viewer", "commenter", "editor", "owner"] as const;
export type Capability = (typeof CAPABILITIES)[number];
// Least-privilege sane default: co-write docs, but not share or delete them.
export const DEFAULT_CAPABILITY: Capability = "editor";

/**
 * What a connector added inside an AI app (/oauth/authorize) is offered by
 * default: full access. Such a person has no other way into Markbase yet —
 * they connected from the chat and may never open the app — so sharing a
 * document, which needs Owner, has to work from the chat. The page still
 * shows the choice, and it can be lowered later under API keys.
 */
export const CONNECTOR_DEFAULT_CAPABILITY: Capability = "owner";

export const CAPABILITY_HELP: Record<Capability, string> = {
  viewer: "Viewer — read only",
  commenter: "Commenter — read and comment",
  editor: "Editor — read and edit documents",
  owner: "Owner — full access, including share and delete",
};

/** The capability a form sent, or the default when it sent none we know. */
export function pickedCapability(
  value: FormDataEntryValue | string | null | undefined,
  fallback: Capability = DEFAULT_CAPABILITY
): Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value)
    ? (value as Capability)
    : fallback;
}
