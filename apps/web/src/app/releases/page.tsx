import { Markdown } from "@markbase/ui/markdown";
import { MAC_DOWNLOAD_URL } from "@markbase/protocol/downloads";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Releases — Markbase",
  description: "What changed in each release of the Markbase desktop app, newest first.",
};

// The desktop app's releases, newest first. The download button everywhere on
// the site follows GitHub's "latest" release (see @markbase/protocol/downloads),
// so it needs no edit when a version ships — this page is where the version
// gets a name and a list of what changed. Add the new one at the top when
// apps/app/scripts/publish-dmg.sh publishes it.
const CONTENT = `# Releases

The Markbase desktop app for macOS (Apple silicon).
[Download the latest](${MAC_DOWNLOAD_URL}). The build is not notarised yet:
the first time, right-click the app and choose **Open**.

## 0.0.7

_November 9, 2026_

**Teams on their own instance**

- A self-hosted instance is invite-only. The first account created on a fresh
  instance is its admin; after that, anyone signed in adds a teammate's address
  under Settings → Invite your team and sends them the join link.
- Opening a join link points the app at the team's instance and opens the
  sign-up right in the app's window, so the invited person creates their
  account there and is in.
- The sign-in, sign-up and join pages inside the app have an instance switcher
  in the top-right corner: back to markbase.so, or to another instance by
  address.
- Settings shows which instance the app is on, and the invite list with the
  link to copy or rotate.

**Vaults**

- A folder that already belongs to another vault is refused the moment it is
  picked, and the default folder is checked before the vault is created, so a
  refusal no longer leaves a vault behind without a folder.
- When a file and the cloud changed the same lines, the document keeps the
  cloud's text and your version is saved in a \`.conflicts\` folder inside the
  vault. Conflict markers are never written into a document any more.

## 0.0.6

_November 4, 2026_

- One build for the hosted app and every self-hosted instance: the app asks
  the instance which project it runs on, and nothing about an instance is
  baked into the download.
- A team's join page can hand the app its instance with **Open in desktop
  app**.

Every build is on
[GitHub](https://github.com/Markbase-Team/Markbase/releases); the ones before
0.0.7 are on [the old downloads page](https://github.com/Jarxi/markbase-releases/releases).
`;

export default function ReleasesPage() {
  return (
    <div className="min-h-svh bg-white text-zinc-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="max-w-3xl">
          <Markdown content={CONTENT} />
        </div>
      </main>
    </div>
  );
}
