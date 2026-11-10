import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { docExtensions } from "./extensions";

// THE shared ProseMirror schema — derived headlessly from the TipTap extension
// set, so it is byte-for-byte the same schema the client editor uses. That
// parity is what lets a step applied in the browser produce the identical
// document on the server, and keeps the markdown export deterministic.
//
// getSchema needs no DOM, so this runs fine on the server. Everything else
// (steps, markdown, anchors) is parametric over this schema.
export const docSchema: Schema = getSchema(docExtensions);
