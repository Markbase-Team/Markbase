import { redirect } from "next/navigation";
import { OAUTH_AUTHORIZE_PATH, checkAuthorize, type AuthorizeParams } from "@markbase/server/mcp-oauth";
import { CapabilitySelect } from "@/components/capability-select";
import { DEFAULT_CAPABILITY } from "@/lib/capabilities";
import { oauthSecret } from "@/lib/mcp-oauth";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata = { title: "Connect an app", robots: { index: false } };

/** Where the key is about to be sent, as a person can check it: the host, or the app's scheme. */
function destination(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (url.protocol === "https:") return url.host;
  if (url.protocol === "http:") return "this computer";
  return `the app that opens ${url.protocol}// links`;
}

// The browser step of sign-in for the hosted MCP server (/mcp). An MCP client
// (Claude, ChatGPT, Cursor…) sends the person here; when they approve, the
// approve route mints an API key for the client and sends it back a one-time
// code for it. The counterpart of /cli-auth, for a client that is not on this
// machine. Only the signed-in person can approve, and only for themselves.
export default async function OAuthAuthorizePage({ searchParams }: { searchParams: Promise<AuthorizeParams> }) {
  const params = await searchParams;
  const checked = checkAuthorize(params, oauthSecret());

  const user = await getCurrentUser();
  if (!user) {
    // Every parameter survives the trip through /login.
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (typeof value === "string" && value !== "") query.set(name, value);
    }
    redirect(`/login?next=${encodeURIComponent(`${OAUTH_AUTHORIZE_PATH}?${query.toString()}`)}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        {checked.ok ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Connect {checked.client.name} to Markbase</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {checked.client.name} will work on your documents as{" "}
              <span className="font-medium text-foreground">{user.email}</span>. A new API key is created for it and
              sent to <span className="font-medium text-foreground">{destination(checked.redirectUri)}</span>.
            </p>
            <form method="post" action={`${OAUTH_AUTHORIZE_PATH}/approve`} className="mt-8">
              <input type="hidden" name="client_id" value={checked.clientId} />
              <input type="hidden" name="redirect_uri" value={checked.redirectUri} />
              <input type="hidden" name="code_challenge" value={checked.challenge} />
              <input type="hidden" name="code_challenge_method" value="S256" />
              <input type="hidden" name="response_type" value="code" />
              <input type="hidden" name="state" value={params.state ?? ""} />

              <CapabilitySelect defaultValue={DEFAULT_CAPABILITY} subject={checked.client.name} />

              <button
                type="submit"
                name="decision"
                value="allow"
                className="mt-6 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.98]"
              >
                Connect
              </button>
              <button
                type="submit"
                name="decision"
                value="deny"
                className="mt-2 w-full rounded-lg border px-4 py-3 text-sm font-medium transition hover:bg-muted"
              >
                Cancel
              </button>
            </form>
            <p className="mt-4 text-xs text-muted-foreground">
              Only connect an app you started this from. You can revoke it anytime in Settings, under API keys.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">This app cannot be connected</h1>
            <p className="mt-3 text-sm text-destructive">{checked.reason}</p>
          </>
        )}
      </div>
    </main>
  );
}
