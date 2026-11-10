import { FileText } from "lucide-react";

export const metadata = { title: "Documents" };

// The index of the documents surface. The folder/doc tree and vault switcher live
// in the documentation sidebar (the layout's DocsShell), so this is just the
// resting state shown until a document is opened.
//
// Onboarding (the shared welcome doc) is NOT seeded here. It used to be, which
// meant a once-per-user-ever operation cost a database round trip on every single
// navigation to this surface, forever. It now runs on the way in — see
// lib/seed-new-user.ts.
export default function DocumentsPage() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border bg-muted">
        <FileText className="size-6 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Open a document from the sidebar, or press{" "}
        <span className="font-medium text-foreground">+</span> to create one.
      </p>
    </div>
  );
}
