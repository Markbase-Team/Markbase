import { supabase } from "@markbase/server/supabase";
import { indexProperties } from "@markbase/shared/docs/properties";

// Keeps a document's indexed properties (documents.properties and
// doc_properties) in step with its front matter. Called wherever the server
// learns a document's new text: an edit through the API (editDocCrdt), a
// snapshot from the editor or the sync daemon (docs_writeCrdt), and creation.
// The database function does nothing when the front matter is unchanged.

/** Index a document's properties from its markdown. True when they changed. */
export async function indexDocProperties(docId: string, markdown: string): Promise<boolean> {
  const { properties, rows } = indexProperties(markdown);
  const { data, error } = await supabase
    .schema("docs")
    .rpc("set_doc_properties", { doc: docId, props: properties, rows });
  if (error) throw new Error(`Couldn't index the document's properties: ${error.message}`);
  return data === true;
}
