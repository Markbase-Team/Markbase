"use client";

import { ArrowLeft, Lock } from "lucide-react";
import { useNavigation } from "@markbase/ui/navigation";
import { useDocsRouting } from "../routing";

// Shown when a signed-in user opens a document that exists but isn't shared with
// them. Instead of a bare 404, explain the situation and point them at the owner
// to request access. We intentionally don't surface the owner's email here.
export function DocNoAccess({ ownerName }: { ownerName: string | null }) {
  // A client component now, only so the link can come from the shell rather
  // than from `next/link`. Nothing here needs the server.
  const { Link } = useNavigation();
  const { docUrl } = useDocsRouting();
  const ownerLabel = ownerName || "the document owner";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-muted">
        <Lock className="size-6 text-muted-foreground" />
      </div>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">
        You don&apos;t have access to this document
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This document is private. Ask{" "}
        <span className="font-medium text-foreground">{ownerLabel}</span> to share
        it with you or send you a link with access.
      </p>

      <div className="mt-6">
        <Link
          href={docUrl(null, null)}
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition hover:bg-muted"
        >
          <ArrowLeft className="size-4" />
          Back to documents
        </Link>
      </div>
    </main>
  );
}
