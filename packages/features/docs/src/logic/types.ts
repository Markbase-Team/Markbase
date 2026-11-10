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

/** Who made an edit or comment — humans, agents, and guests share one API. */
export type Author = {
  kind: "user" | "agent" | "guest";
  id?: string;
  name: string;
};

/** A resolved comment anchor: a position range plus the text it was pinned to. */
export type Anchor = {
  from: number;
  to: number;
  quote: string;
};
