// Index every document's properties from its current text: the first time,
// after the doc_properties migration, and any time the index is suspected of
// being wrong (it is a copy of the front matter, so rebuilding it loses
// nothing).
//
//   SUPABASE_URL=… SUPABASE_SECRET_KEY=… npx tsx packages/features/docs/scripts/backfill-properties.ts
//   … --dry-run   count what would be indexed, write nothing
//
// The text is the document's CRDT (what the editor shows), falling back to the
// row's copy for a document whose CRDT was never written. Trashed documents
// are left alone; they are indexed again if they come back and are edited.
import { supabase } from "@markbase/server/supabase";
import { getMarkdown } from "@markbase/shared/docs";
import { indexProperties } from "@markbase/shared/docs/properties";
import { indexDocProperties, readDocCrdt } from "../src/server";

const PAGE = 200;
const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  let from = 0;
  let seen = 0;
  let withProperties = 0;
  let changed = 0;
  let failed = 0;
  for (;;) {
    const { data, error } = await supabase
      .schema("docs")
      .from("documents")
      .select("id, content")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't list documents: ${error.message}`);
    if (!data?.length) break;
    for (const row of data as { id: string; content: string }[]) {
      seen++;
      try {
        const markdown = await readDocCrdt(row.id, row.content ?? "", getMarkdown);
        if (Object.keys(indexProperties(markdown).properties).length) withProperties++;
        if (!dryRun && (await indexDocProperties(row.id, markdown))) changed++;
      } catch (e) {
        failed++;
        console.error(`${row.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    from += PAGE;
  }
  console.log(
    `${seen} documents, ${withProperties} with front matter` +
      (dryRun ? " (dry run, nothing written)" : `, ${changed} indexed`) +
      (failed ? `, ${failed} failed` : ""),
  );
  if (failed) process.exit(1);
}

void main();
