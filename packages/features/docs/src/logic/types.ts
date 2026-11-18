// Serialization boundary types. ProseMirror's own toJSON/fromJSON are typed
// `any`; rather than leak that, we describe the JSON shapes structurally with a
// JSONValue, and the document/step payloads as JSON objects. Everything that
// crosses the wire or the database (doc snapshots, steps) uses these.

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/** A serialized ProseMirror document (`Node.toJSON()`). */
export type DocJSON = { [key: string]: JSONValue };

/** A serialized ProseMirror step (`Step.toJSON()`). One entry in the op log. */
export type StepJSON = { [key: string]: JSONValue };

/**
 * Who made an edit or comment — humans, agents, and guests share one API.
 *
 * A person has an account and an agent has its owner's: `userId` is what a
 * comment or step records as its author, and what access is checked against.
 * A guest on a share link has none, and the kind says so — there is no
 * "maybe" account.
 */
export type Author =
  | { kind: "user" | "agent"; userId: string; name: string }
  | { kind: "guest"; name: string };

/** The account behind an author, or null for a guest — what a record stores as its author id. */
export function accountOf(author: Author): string | null {
  return author.kind === "guest" ? null : author.userId;
}

/** A resolved comment anchor: a position range plus the text it was pinned to. */
export type Anchor = {
  from: number;
  to: number;
  quote: string;
};
