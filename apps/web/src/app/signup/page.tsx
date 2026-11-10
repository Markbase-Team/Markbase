import Image from "next/image";
import Link from "next/link";
import { DEFAULT_APP_URL } from "@markbase/protocol/instance";
import { AuthForm } from "@/components/auth-form";
import { InstanceSwitcher } from "@/components/instance-switcher";
import { inDesktopApp } from "@/lib/desktop";
import { instanceUrl } from "@/lib/instance-url";
import { instanceHasAccounts, verifyInviteCode } from "@/lib/invite";
import { safeNext } from "@/lib/routes";
import { authProviders } from "@/lib/supabase/auth-providers";
import { JoinForm } from "@/app/join/join-form";

// Creating an account.
//
// On the hosted app, sign-up is open and this is the usual form. A team
// instance is invite-only, with one exception: while it has no accounts at
// all, this page is open to the person setting it up — there is nobody to
// have issued an invite — and the account it creates is the admin's. After
// that it needs the instance's invite code (?code=…, which the join link
// carries and the desktop app passes on at its sign-in there), and creates
// the account for an invited address, continuing to ?next — the app's
// /cli-auth, say. Without a valid code it says so, here, and offers Log in:
// it never bounces to /join, because this page is what the desktop app shows
// in its own window, and /join (download, "Open in desktop app") is a page
// for a browser.
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; code?: string }>;
}) {
  const [{ next, code }, providers, url, desktop] = await Promise.all([
    searchParams,
    authProviders(),
    instanceUrl(),
    inDesktopApp(),
  ]);
  // New users land on Documents, which seeds + shows their welcome doc. Honor an
  // explicit ?next if one was passed; only internal targets are allowed.
  const target = safeNext(next);

  if (url === DEFAULT_APP_URL) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <AuthForm mode="signup" next={target} googleEnabled={providers.google} />
          {desktop && <InstanceSwitcher appUrl={url} />}
        </div>
      </main>
    );
  }

  const invite = code?.trim() ?? "";
  const [first, invited] = await Promise.all([
    instanceHasAccounts().then((has) => !has),
    verifyInviteCode(invite),
  ]);
  const host = new URL(url).host;
  const login = `/login?next=${encodeURIComponent(target)}${invited ? `&code=${encodeURIComponent(invite)}` : ""}`;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image src="/logo.png" alt="" width={56} height={56} priority className="size-14 object-contain" />
          <h1 className="mt-6 text-2xl font-bold tracking-tight">{first ? `Set up ${host}` : `Join ${host}`}</h1>
          <p className="mt-1 text-2xl font-bold tracking-tight text-muted-foreground">Your team&apos;s Markbase</p>
        </div>
        {first ? (
          <>
            <p className="mb-4 text-center text-sm text-muted-foreground">
              This instance has no accounts yet. The first one is the admin&apos;s — create it with your
              own address.
            </p>
            <JoinForm code="" next={target} label="Create your admin account" />
          </>
        ) : invited ? (
          <>
            <p className="mb-4 text-center text-sm text-muted-foreground">
              Create your account with the address your teammate invited.
            </p>
            <JoinForm code={invite} next={target} />
          </>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            This invite link is not valid any more. Ask a teammate for a new one — it is under
            Settings in their Markbase.
          </p>
        )}
        {!first && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href={login} className="font-medium text-foreground hover:underline">
              Log in
            </Link>
          </p>
        )}
        {desktop && <InstanceSwitcher appUrl={url} />}
      </div>
    </main>
  );
}
