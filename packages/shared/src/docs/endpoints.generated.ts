// GENERATED from the endpoints defined in src/handlers — do not edit.
//
// An endpoint is written once, beside the code that answers it:
// `endpoint({ id, method, path, capability, … }, async (req, params, auth) => …)`.
// This is the description half of each, as plain data, for everything that
// must not import server code: the CLI, the MCP server, the skill, the browser.
// Change the definition, then run:
//   npm run gen:endpoints
import type { DocEndpoint } from "./endpoints";

export const GENERATED_DOC_ENDPOINTS: readonly DocEndpoint[] = [
  {
    "id": "docs_searchDocs",
    "method": "GET",
    "path": "/docs/search",
    "capability": null,
    "scope": "read",
    "params": [
      {
        "name": "q",
        "type": "string",
        "required": true,
        "description": "What to look for, in titles and in the text."
      },
      {
        "name": "vault",
        "type": "string",
        "description": "Only the documents in one of your vaults."
      },
      {
        "name": "scope",
        "type": "string",
        "description": "`shared`: only documents other people shared with you."
      }
    ],
    "summary": "Search your documents by title and text",
    "skill": {
      "whenToUse": "To find a document by what it says rather than listing them all and reading each.",
      "input": "?q=<words> · ?vault=<id> · ?scope=shared",
      "output": "{ hits: [{ id, title, snippet }] }",
      "example": "curl -s -H \"$AUTH\" -H \"$CLIENT\" \"$BASE/docs/search?q=roadmap\" | jq '.hits'"
    }
  },
  {
    "id": "docs_history",
    "method": "GET",
    "path": "/docs/:id/history",
    "capability": "viewer",
    "scope": "read",
    "summary": "Version history (who changed what, +added/−removed)",
    "skill": {
      "whenToUse": "To see how a document evolved or find a version to restore.",
      "input": "",
      "output": "{ version, revisions: [{ from_version, to_version, author, added, removed }] }",
      "example": "curl -s -H \"$AUTH\" -H \"$CLIENT\" \"$BASE/docs/$ID/history\" | jq '.revisions'"
    }
  },
  {
    "id": "docs_analytics",
    "method": "GET",
    "path": "/docs/:id/analytics",
    "capability": "viewer",
    "scope": "read",
    "summary": "Analytics (which agents read it and for whom, who wrote each line)",
    "skill": {
      "whenToUse": "To see which agents read a document and on whose behalf, or who wrote what is in it now — a person, or an agent and whose agent.",
      "input": "",
      "output": "{ reads: [{ agent, owner, count, lastAt, text }], credit: { lines, shares: [{ writer, text, lines }], ranges: [{ from, to, writer, text, preview }] } } — text is the writer in words (\"Jessie's Claude\"); writer.kind is agent, person, mixed or unrecorded; credit is null when the history cannot be read",
      "example": "curl -s -H \"$AUTH\" -H \"$CLIENT\" \"$BASE/docs/$ID/analytics\" | jq '.credit.shares'"
    }
  },
  {
    "id": "docs_docAt",
    "method": "GET",
    "path": "/docs/:id/at",
    "capability": "viewer",
    "scope": "read",
    "params": [
      {
        "name": "version",
        "type": "number",
        "required": true,
        "description": "Version to read."
      }
    ],
    "summary": "The document as of a version"
  },
  {
    "id": "docs_docDiff",
    "method": "GET",
    "path": "/docs/:id/diff",
    "capability": "viewer",
    "scope": "read",
    "params": [
      {
        "name": "from",
        "type": "number",
        "required": true,
        "description": "Older version."
      },
      {
        "name": "to",
        "type": "number",
        "required": true,
        "description": "Newer version."
      }
    ],
    "summary": "Word-level diff between two versions"
  },
  {
    "id": "docs_reportHookEvents",
    "method": "POST",
    "path": "/hook-events",
    "capability": null,
    "scope": "write",
    "summary": "Report what agents' hooks saw of vault files: reads and writes, one event each",
    "humanOnly": true,
    "why": "The sync daemon's report of its machine's hook ledgers. An agent's own calls are recorded as they happen."
  },
  {
    "id": "docs_listDocs",
    "method": "GET",
    "path": "/docs",
    "capability": null,
    "scope": "read",
    "params": [
      {
        "name": "scope",
        "type": "string",
        "description": "`shared`: only documents other people shared with you (each with your `capability` on it)."
      },
      {
        "name": "vault",
        "type": "string",
        "description": "Only the documents in one of your vaults."
      }
    ],
    "summary": "List your documents",
    "skill": {
      "whenToUse": "To find a document or see what you can access. `?scope=shared` lists what others shared with you, with your capability on each.",
      "input": "?scope=shared · ?vault=<id> · (nothing: your own documents)",
      "output": "{ docs: [{ id, title, excerpt, version, updated_at, capability? }] }",
      "example": "curl -s -H \"$AUTH\" -H \"$CLIENT\" \"$BASE/docs\" | jq '.docs'"
    }
  },
  {
    "id": "docs_createDoc",
    "method": "POST",
    "path": "/docs",
    "capability": null,
    "scope": "write",
    "params": [
      {
        "name": "title",
        "type": "string",
        "description": "Document title."
      },
      {
        "name": "content",
        "type": "string",
        "description": "Initial markdown for the first version."
      },
      {
        "name": "vault_id",
        "type": "string",
        "required": false,
        "description": "One of your own vaults to create it in; omitted, your default vault. Someone else's vault is refused (403)."
      }
    ],
    "summary": "Create a document",
    "skill": {
      "whenToUse": "To start a new document. Seed the first version with `content` markdown; edit it afterwards with /edits.",
      "input": "{ title?: string, content?: markdown }",
      "output": "{ doc: { id, title, version, … } }",
      "example": "curl -s -X POST -H \"$AUTH\" -H \"$CLIENT\" -H 'content-type: application/json' \\\n  -d '{\"title\":\"My doc\",\"content\":\"# My doc\\n\"}' \"$BASE/docs\""
    }
  },
  {
    "id": "docs_readDoc",
    "method": "GET",
    "path": "/docs/:id",
    "capability": "viewer",
    "scope": "read",
    "summary": "Read one document (markdown + current version)",
    "skill": {
      "whenToUse": "Always read before you edit — you quote from the current text.",
      "input": "",
      "output": "{ doc: { id, title, content: markdown, version }, capability }",
      "example": "curl -s -H \"$AUTH\" -H \"$CLIENT\" \"$BASE/docs/$ID\" | jq -r '.doc.content'"
    }
  },
  {
    "id": "docs_renameDoc",
    "method": "PATCH",
    "path": "/docs/:id",
    "capability": "editor",
    "scope": "write",
    "params": [
      {
        "name": "title",
        "type": "string",
        "required": true,
        "description": "New title."
      }
    ],
    "summary": "Rename a document"
  },
  {
    "id": "docs_deleteDoc",
    "method": "DELETE",
    "path": "/docs/:id",
    "capability": "owner",
    "scope": "write",
    "summary": "Delete a whole document (all its tabs)",
    "destructive": true
  },
  {
    "id": "docs_setMemberPath",
    "method": "PATCH",
    "path": "/docs/:id/membership",
    "capability": "viewer",
    "scope": "write",
    "params": [
      {
        "name": "path",
        "type": "string",
        "description": "Where the document sits in your Shared Vault; null for the default layout."
      }
    ],
    "summary": "File a shared document in your Shared Vault",
    "humanOnly": true,
    "why": "A folder layout is a person's own."
  },
  {
    "id": "docs_leaveShare",
    "method": "DELETE",
    "path": "/docs/:id/membership",
    "capability": "viewer",
    "scope": "write",
    "summary": "Leave a document someone shared with you",
    "humanOnly": true,
    "why": "Leaving a share is the person's decision, not an edit."
  },
  {
    "id": "docs_replaceContent",
    "method": "PUT",
    "path": "/docs/:id/content",
    "capability": "editor",
    "scope": "write",
    "params": [
      {
        "name": "content",
        "type": "string",
        "required": true
      },
      {
        "name": "version",
        "type": "number",
        "required": true,
        "description": "The version the caller last saw; a newer one answers 409."
      }
    ],
    "summary": "Replace a whole document's text",
    "humanOnly": true,
    "why": "The folder mirror's write. An agent replacing a whole document overwrites what people are typing; it edits a quoted passage through /edits instead."
  },
  {
    "id": "docs_editDoc",
    "method": "POST",
    "path": "/docs/:id/edits",
    "capability": "editor",
    "scope": "write",
    "params": [
      {
        "name": "quote",
        "type": "string",
        "required": true,
        "description": "Exact rendered text to replace (no markdown syntax)."
      },
      {
        "name": "insert",
        "type": "string",
        "required": true,
        "description": "Replacement markdown (structure preserved)."
      }
    ],
    "summary": "Edit a passage (quote → insert) — the only way to change a doc",
    "skill": {
      "whenToUse": "Every change to an existing document. `quote` matches the rendered text (no markdown syntax — `ready`, not `**ready**`); `insert` is markdown whose structure is preserved (inline marks merge; headings/lists become real blocks). To add, quote an anchor line and repeat it at the start of `insert`.",
      "input": "{ quote: string (rendered text), insert: markdown }",
      "output": "{ version: number }  ·  422 if the quote didn’t match  ·  409 on conflict",
      "example": "curl -s -X POST -H \"$AUTH\" -H \"$CLIENT\" -H 'content-type: application/json' \\\n  -d '{\"quote\":\"Status: draft\",\"insert\":\"Status: **ready**\"}' \"$BASE/docs/$ID/edits\""
    }
  },
  {
    "id": "docs_restoreDoc",
    "method": "POST",
    "path": "/docs/:id/restore",
    "capability": "editor",
    "scope": "write",
    "params": [
      {
        "name": "version",
        "type": "number",
        "required": true,
        "description": "The version to restore."
      }
    ],
    "summary": "Restore a past version (appended as a new edit)",
    "skill": {
      "whenToUse": "To undo back to a known-good version; history is preserved.",
      "input": "{ version: number }",
      "output": "{ version: number }",
      "example": "curl -s -X POST -H \"$AUTH\" -H \"$CLIENT\" -H 'content-type: application/json' \\\n  -d '{\"version\":N}' \"$BASE/docs/$ID/restore\""
    }
  },
  {
    "id": "docs_listComments",
    "method": "GET",
    "path": "/docs/:id/comments",
    "capability": "viewer",
    "scope": "read",
    "summary": "List comments"
  },
  {
    "id": "docs_addComment",
    "method": "POST",
    "path": "/docs/:id/comments",
    "capability": "commenter",
    "scope": "write",
    "params": [
      {
        "name": "body",
        "type": "string",
        "required": true,
        "description": "The comment (markdown)."
      },
      {
        "name": "quotedText",
        "type": "string",
        "description": "Text to anchor the comment to."
      },
      {
        "name": "parentId",
        "type": "string",
        "description": "Reply to this comment id."
      }
    ],
    "summary": "Comment on a passage / ask the human a question",
    "skill": {
      "whenToUse": "When you have a real question or a suggestion you shouldn’t just apply. Anchor it to text with `quotedText`. Calls the Markbase API, POST /api/v1/docs/{id}/comments; see https://markbase.so/docs/agents.",
      "input": "{ body: markdown, quotedText?: string, parentId?: uuid }",
      "output": "{ comment: { … } }",
      "example": "curl -s -X POST -H \"$AUTH\" -H \"$CLIENT\" -H 'content-type: application/json' \\\n  -d '{\"body\":\"X or Y?\",\"quotedText\":\"the passage\"}' \"$BASE/docs/$ID/comments\""
    }
  },
  {
    "id": "docs_resolveComment",
    "method": "PATCH",
    "path": "/docs/:id/comments/:cid",
    "capability": "commenter",
    "scope": "write",
    "params": [
      {
        "name": "resolved",
        "type": "boolean",
        "required": true,
        "description": "true to resolve, false to reopen."
      }
    ],
    "summary": "Resolve / unresolve a comment"
  },
  {
    "id": "docs_listLinks",
    "method": "GET",
    "path": "/docs/:id/links",
    "capability": "owner",
    "scope": "read",
    "summary": "List share links"
  },
  {
    "id": "docs_createLink",
    "method": "POST",
    "path": "/docs/:id/links",
    "capability": "owner",
    "scope": "write",
    "params": [
      {
        "name": "mode",
        "type": "string",
        "required": true,
        "description": "'guest' or 'member'."
      },
      {
        "name": "capability",
        "type": "string",
        "description": "editor / commenter / viewer."
      }
    ],
    "summary": "Create a share link"
  },
  {
    "id": "docs_deleteLink",
    "method": "DELETE",
    "path": "/docs/:id/links/:linkId",
    "capability": "owner",
    "scope": "write",
    "summary": "Revoke a share link",
    "destructive": true
  },
  {
    "id": "docs_listTabs",
    "method": "GET",
    "path": "/docs/:id/tabs",
    "capability": "viewer",
    "scope": "read",
    "summary": "List the document's tabs",
    "humanOnly": true,
    "why": "Tabs were removed from the app; the endpoints stay for documents that still have them."
  },
  {
    "id": "docs_addTab",
    "method": "POST",
    "path": "/docs/:id/tabs",
    "capability": "editor",
    "scope": "write",
    "summary": "Add a tab",
    "humanOnly": true,
    "why": "Tabs were removed from the app; the endpoints stay for documents that still have them."
  },
  {
    "id": "docs_reorderTabs",
    "method": "PATCH",
    "path": "/docs/:id/tabs",
    "capability": "editor",
    "scope": "write",
    "params": [
      {
        "name": "order",
        "type": "json",
        "required": true,
        "description": "Array of tab ids in the new order."
      }
    ],
    "summary": "Reorder tabs",
    "humanOnly": true,
    "why": "Tabs were removed from the app; the endpoints stay for documents that still have them."
  },
  {
    "id": "docs_deleteTab",
    "method": "DELETE",
    "path": "/docs/:id/tabs/:tabId",
    "capability": "editor",
    "scope": "write",
    "summary": "Delete a tab (never the last)",
    "humanOnly": true,
    "why": "Tabs were removed from the app; the endpoints stay for documents that still have them."
  },
  {
    "id": "docs_publishStatus",
    "method": "GET",
    "path": "/docs/:id/publish",
    "capability": "owner",
    "scope": "read",
    "summary": "Whether a document is published, its public URL, and the versions to choose from"
  },
  {
    "id": "docs_publish",
    "method": "POST",
    "path": "/docs/:id/publish",
    "capability": "owner",
    "scope": "write",
    "params": [
      {
        "name": "version",
        "type": "number",
        "description": "The version index (from /history) to publish; omitted, the text as it stands."
      }
    ],
    "summary": "Publish a document to the web (anyone with the URL can read it)"
  },
  {
    "id": "docs_unpublish",
    "method": "DELETE",
    "path": "/docs/:id/publish",
    "capability": "owner",
    "scope": "write",
    "summary": "Take a published document offline"
  },
  {
    "id": "docs_listVaults",
    "method": "GET",
    "path": "/vaults",
    "capability": null,
    "scope": "read",
    "summary": "List your vaults",
    "skill": {
      "whenToUse": "To see which vaults exist before listing, searching or creating documents in one.",
      "input": "(nothing)",
      "output": "{ vaults: [{ id, name, created_at }] }",
      "example": "curl -s -H \"$AUTH\" -H \"$CLIENT\" \"$BASE/vaults\" | jq '.vaults'"
    }
  },
  {
    "id": "docs_createVault",
    "method": "POST",
    "path": "/vaults",
    "capability": null,
    "scope": "write",
    "params": [
      {
        "name": "name",
        "type": "string",
        "required": true
      }
    ],
    "summary": "Create a vault"
  },
  {
    "id": "docs_readVault",
    "method": "GET",
    "path": "/vaults/:id",
    "capability": null,
    "scope": "read",
    "summary": "One of your vaults (404: gone; 403: somebody else's)"
  },
  {
    "id": "docs_renameVault",
    "method": "PATCH",
    "path": "/vaults/:id",
    "capability": null,
    "scope": "write",
    "params": [
      {
        "name": "name",
        "type": "string",
        "required": true
      }
    ],
    "summary": "Rename a vault"
  },
  {
    "id": "docs_deleteVault",
    "method": "DELETE",
    "path": "/vaults/:id",
    "capability": null,
    "scope": "write",
    "summary": "Delete a vault and every document in it",
    "destructive": true
  },
  {
    "id": "docs_convertFolderToVault",
    "method": "POST",
    "path": "/vaults/convert",
    "capability": null,
    "scope": "write",
    "params": [
      {
        "name": "fromVaultId",
        "type": "string",
        "required": true
      },
      {
        "name": "folder",
        "type": "string",
        "required": true,
        "description": "The folder inside that vault, vault-relative."
      },
      {
        "name": "name",
        "type": "string",
        "required": true,
        "description": "The new vault's name."
      }
    ],
    "summary": "Make a folder inside a vault a vault of its own"
  },
  {
    "id": "docs_listAssets",
    "method": "GET",
    "path": "/assets",
    "capability": null,
    "scope": "read",
    "params": [
      {
        "name": "vault",
        "type": "string",
        "description": "One of your vaults: every file in it. Exclusive with doc."
      },
      {
        "name": "doc",
        "type": "string",
        "description": "A document you can read: the files it links to. Exclusive with vault."
      },
      {
        "name": "urls",
        "type": "string",
        "description": "`0`: leave out the signed download URLs."
      }
    ],
    "summary": "List the images and files in a vault, or the ones a document links to"
  },
  {
    "id": "docs_uploadAsset",
    "method": "POST",
    "path": "/assets",
    "capability": null,
    "scope": "write",
    "summary": "Upload an image or file into a vault",
    "humanOnly": true,
    "why": "It takes a multipart file upload, which a tool call's JSON arguments cannot carry."
  },
  {
    "id": "docs_readCrdt",
    "method": "GET",
    "path": "/docs/:id/crdt",
    "capability": "viewer",
    "scope": "read",
    "summary": "The document's CRDT snapshot",
    "humanOnly": true,
    "why": "The editor's and the sync daemon's transport. An agent edits through /edits, which lands in the same state."
  },
  {
    "id": "docs_writeCrdt",
    "method": "POST",
    "path": "/docs/:id/crdt",
    "capability": "editor",
    "scope": "write",
    "summary": "Merge a CRDT snapshot into the document",
    "humanOnly": true,
    "why": "The editor's and the sync daemon's transport. An agent edits through /edits, which lands in the same state."
  },
  {
    "id": "docs_crdtChanges",
    "method": "GET",
    "path": "/docs/crdt/changes",
    "capability": null,
    "scope": "read",
    "params": [
      {
        "name": "since",
        "type": "string",
        "required": false,
        "description": "The cursor the last answer returned; absent = establish one."
      },
      {
        "name": "vault",
        "type": "string",
        "required": false,
        "description": "One of your own vaults. Shared documents live in their owner's vault, so they are not in it."
      },
      {
        "name": "scope",
        "type": "string",
        "required": false,
        "description": "`shared`: the documents shared with you, whichever vault they sit in. Exclusive with vault."
      }
    ],
    "summary": "Which of your documents' snapshots changed since a cursor",
    "humanOnly": true,
    "why": "The editor's and the sync daemon's transport. An agent edits through /edits, which lands in the same state."
  }
];
