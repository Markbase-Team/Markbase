import Image from "next/image";
import { openDocLink } from "@markbase/shared/instance";
import { instanceUrl } from "@/lib/instance-url";
import { OpenInApp } from "./open-in-app";

export const metadata = { title: "Open in Markbase", robots: { index: false } };

/** A document id as it may sit in the address; anything else opens the documents list. */
const DOC_ID = /^[A-Za-z0-9-]{1,64}$/;

// "Open in Markbase" from outside Markbase — a card in an AI app's
// conversation — lands here. The desktop app is the place to read and edit,
// so it is tried first (markbase://open, see @markbase/shared/instance), and
// the website is where the page goes when the app does not answer: no app
// installed, a phone, a browser that will not hand the link over.
//
// Public, like /join: it shows nothing of anyone's. The document page it
// goes on to asks for sign-in as it always does.
export default async function OpenPage({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  const [url, { doc }] = await Promise.all([instanceUrl(), searchParams]);
  const docId = doc && DOC_ID.test(doc) ? doc : null;
  const webPath = docId ? `/dashboard/documents/${encodeURIComponent(docId)}` : "/dashboard/documents";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image src="/markbase-logo.png" alt="" width={56} height={56} priority className="size-14 object-contain" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight">Open in Markbase</h1>
          <p className="mt-1 text-2xl font-bold tracking-tight text-muted-foreground">
            {docId ? "Your document" : "Your documents"}
          </p>
        </div>
        <OpenInApp appLink={openDocLink(url, docId)} webPath={webPath} />
      </div>
    </main>
  );
}
