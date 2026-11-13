import { pageMetadata } from "@/lib/seo";
import { Markdown } from "@markbase/ui/markdown";

export const metadata = pageMetadata({
  path: "/privacy-policy",
  title: "Privacy Policy — Markbase",
  description: "How Markbase handles your information.",
});

const CONTENT = `# Privacy Policy

_Last updated: June 29, 2026_

This Privacy Policy explains how Markbase ("the app", "we") at
markbase.so handles your information. The app is a personal
project-and-request tracker that can optionally connect to your Google account to
help you triage email.

## Information we collect

- **Account information.** When you sign in with Google, we receive your email
  address and basic profile (name, Google account id) to identify your account.
- **Content you create.** Projects, tickets, requests, work logs, documentation,
  diary entries, and similar content you add, stored so you can access it.
- **Connected Google (Gmail) data — only if you connect it.** If you connect a
  Gmail account, the app requests **read-only** access to your Gmail. It uses
  this to display your inbox and to classify selected emails into your
  "Attention" boards. For emails you file, we store limited metadata (sender,
  subject, a short snippet, date, and the Gmail message id) plus an AI-generated
  summary. We do **not** store full email bodies; full messages are fetched from
  Gmail on demand and shown only to you.

## How we use Google user data

- We use read-only Gmail access solely to provide the in-app features you
  request — viewing your inbox and sorting emails into your boards.
- OAuth refresh tokens are **encrypted at rest** and are never sent to your
  browser.
- We do **not** sell your Google user data, use it for advertising, or transfer
  it to others except as needed to provide the service (see "Service providers").
- The app's use and transfer of information received from Google APIs adheres to
  the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
  including the **Limited Use** requirements.

## Service providers

We use a few processors to run the app:

- **Supabase** — database and storage for your account and content.
- **Vercel** — application hosting.
- **Google** — sign-in and, if you connect it, the Gmail API.
- **Anthropic (Claude)** — AI features such as email classification/summaries and
  running tickets. Only the content needed for a given feature is sent to the
  model to produce the result.

## Data retention and deletion

- You can disconnect a Gmail account at any time, which removes its stored token
  and stops further access.
- You can delete your content from within the app.
- To delete your account and associated data, contact us at the email below.

## Security

Data is stored with the providers above; OAuth tokens are encrypted with
AES-256-GCM. No method of storage or transmission is 100% secure, but we take
reasonable measures to protect your information.

## Changes

We may update this policy; material changes will be reflected by the "Last
updated" date above.

## Contact

Questions about this policy or your data: [hello@markbase.so](mailto:hello@markbase.so).
`;

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Markdown content={CONTENT} />
    </main>
  );
}
