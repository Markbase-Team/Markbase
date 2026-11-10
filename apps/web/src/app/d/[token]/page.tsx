import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  getDocument,
  getLinkByToken,
  getUserDisplay,
  grantMember,
} from "@markbase/docs/server";
import { AuthForm } from "@/components/auth-form";
import { authProviders } from "@/lib/supabase/auth-providers";
import { GuestDoc } from "@markbase/docs/ui/guest-doc";

const CAP_VERB: Record<string, string> = {
  editor: "edit",
  commenter: "comment on",
  viewer: "view",
};

export const dynamic = "force-dynamic";

// Open a share link. A `member` link requires sign-in and grants access, then
// sends the user to the doc; a `guest` link opens the SAME workspace as an
// anonymous guest (its capability decides read/comment). One UI for all roles.
export default async function ShareLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await getLinkByToken(token);
  if (!link) notFound();

  const doc = await getDocument(link.doc_id);
  if (!doc) notFound();

  if (link.mode === "member") {
    const user = await getCurrentUser();
    // Not signed in yet — show an invite landing (doc title + who invited you)
    // with the sign-in UI. After auth, `next` returns here and grants access.
    if (!user) {
      const [owner, providers] = await Promise.all([
        getUserDisplay(doc.owner_id),
        authProviders(),
      ]);
      const ownerLabel = owner.name || owner.email || "Someone";
      const verb = CAP_VERB[link.capability] ?? "view";
      return (
        <main className="flex flex-1 items-center justify-center px-4 py-12">
          <AuthForm
            mode="login"
            next={`/d/${token}`}
            googleEnabled={providers.google}
            title={`${ownerLabel} invited you to ${verb}`}
            subtitle={
              <>
                Sign in to open{" "}
                <span className="rounded-md bg-[#e5ff6e] px-2 py-0.5 text-foreground">
                  {doc.title}
                </span>
              </>
            }
          />
        </main>
      );
    }
    await grantMember({
      docId: doc.id,
      userId: user.id,
      capability: link.capability,
    });
    redirect(`/dashboard/documents/${doc.id}`);
  }

  return (
    <GuestDoc
      docId={doc.id}
      capability={link.capability}
      shareToken={token}
      tabDocs={[
        {
          id: doc.id,
          title: doc.title,
          doc_json: doc.doc_json,
          version: doc.version,
          // Seed only — used if this doc has no cloud CRDT yet, in which case
          // the row's markdown is the truth. Otherwise the CRDT wins on bind.
          seedMarkdown: doc.content,
        },
      ]}
    />
  );
}
