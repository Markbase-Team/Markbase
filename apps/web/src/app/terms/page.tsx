import { pageMetadata } from "@/lib/seo";
import { Markdown } from "@markbase/ui/markdown";

export const metadata = pageMetadata({
  path: "/terms",
  title: "Terms of Service — Markbase",
  description: "Terms governing use of Markbase.",
});

const CONTENT = `# Terms of Service

_Last updated: June 29, 2026_

These Terms govern your use of Markbase at markbase.so
("the app"). By using the app, you agree to these Terms.

## The service

The app is a personal tool for tracking projects and requests, and optionally for
triaging email and running automated coding tasks. It is provided as-is,
primarily for the account owner's own use.

## Your responsibilities

- You are responsible for the accounts you connect and the content you submit.
- Don't use the app to break the law or to access data you aren't authorized to
  access.
- If you connect a Google account, you authorize the app to access it as
  described in the [Privacy Policy](/privacy-policy); you can revoke access at any
  time.

## Third-party services

The app relies on third parties (Google, Supabase, Vercel, Anthropic). Your use of
those services through the app is also subject to their terms.

## No warranty

The app is provided "as is" and "as available", without warranties of any kind.
We do not guarantee it will be uninterrupted, error-free, or secure.

## Limitation of liability

To the maximum extent permitted by law, we are not liable for any indirect,
incidental, or consequential damages arising from your use of the app.

## Changes

We may update these Terms; continued use after changes means you accept them.

## Contact

[hello@markbase.so](mailto:hello@markbase.so).
`;

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Markdown content={CONTENT} />
    </main>
  );
}
