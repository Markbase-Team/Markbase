import { notFound, redirect } from "next/navigation";
import { docJsonIsValid, docJsonToMarkdown, type DocJSON } from "@markbase/docs";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  capabilityFor,
  getDocument,
  getMemberCapability,
} from "@markbase/docs/server";
import { CrdtEditor } from "@markbase/docs/ui/crdt-editor";

// Opens a real document in CRDT mode (roadmap F1). Same access rules as the main
// editor; the CRDT is seeded from the document's current content on first open,
// then it (and any connected worker/vault) become the source of truth. This runs
// alongside the /steps editor while the migration is proven out.
export default async function CrdtDocPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/dashboard/documents/${id}/crdt`);

  const doc = await getDocument(id);
  if (!doc || !docJsonIsValid(doc.doc_json)) notFound();

  const memberCapability = await getMemberCapability(id, user.id);
  const capability = capabilityFor({
    ownerId: doc.owner_id,
    actor: { kind: "user", id: user.id, userId: user.id, name: user.email ?? "" },
    memberCapability,
    guestCapability: null,
  });
  if (!capability) notFound();

  const initialMarkdown = docJsonToMarkdown(doc.doc_json as DocJSON);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="mb-1 text-xl font-bold tracking-tight">{doc.title}</h1>
      <p className="mb-6 text-sm text-[var(--text-muted)]">CRDT mode (experimental)</p>
      <CrdtEditor docId={doc.id} initialMarkdown={initialMarkdown} />
    </div>
  );
}
