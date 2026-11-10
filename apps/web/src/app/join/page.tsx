import Image from "next/image";
import Link from "next/link";
import { AppWindow, Download } from "lucide-react";
import { connectLink, DEFAULT_APP_URL } from "@markbase/protocol/instance";
import { MAC_DOWNLOAD_URL } from "@markbase/protocol/downloads";
import { InstanceSwitcher } from "@/components/instance-switcher";
import { inDesktopApp } from "@/lib/desktop";
import { instanceUrl } from "@/lib/instance-url";
import { instanceHasAccounts, verifyInviteCode } from "@/lib/invite";

// The join page: the one link a member shares with a teammate.
//
// Its job is to point the desktop app at this instance. The button is a
// markbase://connect link (see @markbase/protocol/instance) carrying the
// instance's address and, on a team instance, the invite code the link came
// with: the app registers the scheme with the OS, so clicking it opens the
// app, which confirms, restarts on this instance and — with the code — opens
// its sign-up, where the invited person creates their account. Nobody types
// an address into the app, and nothing about who is signed in in this browser
// matters here, so the page does not look.
//
// Public, like /login. A team instance's account half is invite-only: the
// link carries ?code=…, Settings shows it to every member, and a bare /join
// has nothing to hand on (see @/lib/invite) — except on an instance with no
// accounts yet, where the first account is the admin's and the sign-up is
// open to whoever is setting it up. The hosted app's sign-up is open at
// /signup, as before.

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const [url, { code }, desktop] = await Promise.all([instanceUrl(), searchParams, inDesktopApp()]);
  const hosted = url === DEFAULT_APP_URL;
  const invite = code?.trim() ?? "";
  const first = !hosted && !(await instanceHasAccounts());
  const invited = !hosted && !first && (await verifyInviteCode(invite));
  const host = new URL(url).host;
  const signup = invited ? `/signup?code=${encodeURIComponent(invite)}` : "/signup";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image src="/logo.png" alt="" width={56} height={56} priority className="size-14 object-contain" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight">
            {hosted ? "Join Markbase" : `Join ${host}`}
          </h1>
          <p className="mt-1 text-2xl font-bold tracking-tight text-muted-foreground">
            {hosted ? "Your team's documents" : "Your team's Markbase"}
          </p>
        </div>

        {first ? (
          <div className="mb-6 flex flex-col gap-3">
            <p className="text-center text-sm text-muted-foreground">
              This instance has no accounts yet. The first one is the admin&apos;s.
            </p>
            <Link
              href="/signup"
              className="flex h-12 w-full items-center justify-center rounded-lg bg-[#e5ff6e] px-4 text-sm font-semibold text-zinc-900 transition hover:brightness-95 active:scale-[0.98]"
            >
              Create the admin account
            </Link>
          </div>
        ) : (
          !hosted &&
          !invited && (
            <p className="mb-6 text-center text-sm text-muted-foreground">
              This invite link is not valid any more. Ask a teammate for a new one — it is under
              Settings in their Markbase.
            </p>
          )
        )}

        <div className="flex flex-col gap-3">
          <a
            href={connectLink(url, invited ? invite : undefined)}
            className={
              first
                ? "flex h-12 w-full items-center justify-center gap-2 rounded-lg border bg-background px-4 text-sm font-medium transition hover:bg-muted"
                : "flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#e5ff6e] px-4 text-sm font-semibold text-zinc-900 transition hover:brightness-95 active:scale-[0.98]"
            }
          >
            <AppWindow className="size-4" />
            Open in desktop app
          </a>
          <a
            href={MAC_DOWNLOAD_URL}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border bg-background px-4 text-sm font-medium transition hover:bg-muted"
          >
            <Download className="size-4" />
            Download for Mac
            <span className="text-xs text-muted-foreground">· Apple silicon</span>
          </a>
          <p className="text-center text-xs text-muted-foreground">
            {hosted
              ? "The app points here out of the box; Open in desktop app just launches it."
              : invited || first
                ? `Opening in the app points it at ${host} and restarts it there, where you create your account. Unsigned build — right-click the app and choose Open the first time.`
                : `Opening in the app points it at ${host} and restarts it there, where you sign in. Unsigned build — right-click the app and choose Open the first time.`}
          </p>
        </div>

        {(hosted || invited) && !first && (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            No desktop app?{" "}
            <Link href={signup} className="font-medium text-foreground hover:underline">
              Create your account in the browser
            </Link>
          </p>
        )}
        {desktop && <InstanceSwitcher appUrl={url} />}
      </div>
    </main>
  );
}
