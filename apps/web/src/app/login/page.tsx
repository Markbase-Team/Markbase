import { redirect } from "next/navigation";
import { DEFAULT_APP_URL } from "@markbase/protocol/instance";
import { AuthForm } from "@/components/auth-form";
import { InstanceSwitcher } from "@/components/instance-switcher";
import { inDesktopApp } from "@/lib/desktop";
import { instanceUrl } from "@/lib/instance-url";
import { instanceKnownEmpty } from "@/lib/invite";
import { safeNext } from "@/lib/routes";
import { authProviders } from "@/lib/supabase/auth-providers";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; code?: string }>;
}) {
  const [{ next, error, code }, providers, url, desktop] = await Promise.all([
    searchParams,
    authProviders(),
    instanceUrl(),
    inDesktopApp(),
  ]);
  // Only internal redirect targets; an explicit ?next still wins.
  const target = safeNext(next);
  // A team instance with no accounts has nobody to log in: the person in
  // front of it is setting it up, and the desktop app's sign-in lands here
  // too, so the way forward is the admin's sign-up.
  if (url !== DEFAULT_APP_URL && (await instanceKnownEmpty())) {
    redirect(`/signup?next=${encodeURIComponent(target)}`);
  }
  // An invited person who came here from the sign-up ("Already have one?")
  // keeps their way back to it: the code is what lets /signup create an
  // account on a team instance.
  const signup = code?.trim()
    ? `/signup?code=${encodeURIComponent(code.trim())}&next=${encodeURIComponent(target)}`
    : undefined;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <AuthForm
          mode="login"
          next={target}
          initialError={error}
          googleEnabled={providers.google}
          footerHref={signup}
        />
        {desktop && <InstanceSwitcher appUrl={url} />}
      </div>
    </main>
  );
}
