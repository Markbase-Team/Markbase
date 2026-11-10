import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  authorizeFraming,
  signedOutRedirect,
  type AuthorizeQuery,
} from "@markbase/protocol/device-auth-contract";
import { AutoApprove } from "./auto-approve";

// A connection's capability is the ceiling on what any agent on this machine can
// do to your documents. It is THE security boundary: agents co-located on one
// machine can read each other's credentials, so a session can never widen this.
export const CAPABILITIES = ["viewer", "commenter", "editor", "owner"] as const;
// Least-privilege sane default: co-write docs, but not share or delete them.
export const DEFAULT_CAPABILITY = "editor";

const CAPABILITY_HELP: Record<(typeof CAPABILITIES)[number], string> = {
  viewer: "Viewer — read only",
  commenter: "Commenter — read and comment",
  editor: "Editor — read and edit documents",
  owner: "Owner — full access, including share and delete",
};

// Only ever hand the minted key back to a loopback address on the user's own
// machine — never an arbitrary URL.
export function isLoopbackCallback(callback: string | undefined): boolean {
  if (!callback) return false;
  try {
    const u = new URL(callback);
    return (
      u.protocol === "http:" &&
      (u.hostname === "127.0.0.1" || u.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

// Browser step of `markbase login`: the CLI opens this page with a loopback
// `callback` + a `state` nonce. Once the signed-in user approves, the approve
// route mints an API key for them and redirects it back to the CLI's local
// server. Gated by the session — only the logged-in user can mint their key.
export default async function CliAuthPage({
  searchParams,
}: {
  searchParams: Promise<AuthorizeQuery>;
}) {
  const query = await searchParams;
  const { callback, state, capability } = query;
  // How the device asked to be treated — read by the shared contract, so what
  // the device sends and what this page expects are one definition (and one
  // test). confirm: this client acknowledges the key once it arrives, so mint
  // it inert (see confirmApiKey); older clients omit it and get a live key.
  // desktop: a person signing into their own app — nothing to decide, and a
  // session for the window too, not just a daemon key.
  const framing = authorizeFraming(query);
  const wantsConfirm = framing.confirm;
  const wantSession = framing.desktop;
  const claudeVersion = framing.claudeVersion;
  // The CLI may pre-select a capability; otherwise least-privilege.
  const defaultCapability =
    capability && (CAPABILITIES as readonly string[]).includes(capability)
      ? capability
      : DEFAULT_CAPABILITY;

  const user = await getCurrentUser();
  if (!user) {
    // Every parameter survives the trip through /login — the contract builds
    // the bounce, so the page cannot drop one again (it dropped `desktop`
    // once, and `confirm` after that).
    redirect(signedOutRedirect(query));
  }

  const valid = isLoopbackCallback(callback);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        {/* Desktop sign-in is the USER signing into their own account — full
            access, no capability to pick. The CLI path authorizes a worker/agents
            on a (possibly shared) machine, so it keeps the capability ceiling and
            the Claude-Code note. Same route, two framings. */}
        <h1 className="text-2xl font-bold tracking-tight">
          {framing.title}
        </h1>
        {valid ? (
          <>
            <p className="mt-3 text-sm text-muted-foreground">
              {wantSession ? (
                <>
                  You&apos;ll be signed in as{" "}
                  <span className="font-medium text-foreground">{user.email}</span>.
                </>
              ) : (
                <>
                  Authorize the worker and agents on this machine to act as{" "}
                  <span className="font-medium text-foreground">{user.email}</span>.
                  A new API key will be created for it.
                </>
              )}
            </p>
            <form id="approve-form" method="post" action="/cli-auth/approve" className="mt-8">
              <input type="hidden" name="callback" value={callback} />
              <input type="hidden" name="state" value={state ?? ""} />
              <input type="hidden" name="claude" value={claudeVersion} />
              <input type="hidden" name="desktop" value={wantSession ? "1" : ""} />
              <input type="hidden" name="confirm" value={wantsConfirm ? "1" : ""} />

              {/* Desktop: nothing to decide — finish automatically. */}
              {framing.autoFinish && <AutoApprove formId="approve-form" />}

              {/* CLI-only: a capability ceiling for agents, and the Claude note.
                  Neither applies to a user signing into their own account. */}
              {!wantSession && (
                <>
                  {!claudeVersion && (
                    <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                      Claude Code wasn&apos;t found on this machine, so projects,
                      agents, and @mention replies stay locked. Install it and run{" "}
                      <code className="font-mono">markbase login</code> again — you
                      can still authorize now and use documents.
                    </p>
                  )}

                  <div className="text-left">
                    <label htmlFor="capability" className="text-sm font-medium">
                      Document access
                    </label>
                    <select
                      id="capability"
                      name="capability"
                      defaultValue={defaultCapability}
                      className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"
                    >
                      {CAPABILITIES.map((c) => (
                        <option key={c} value={c}>
                          {CAPABILITY_HELP[c]}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      The most any agent on this machine can do to your documents.
                      Nothing an agent does can exceed it. Change it later under API
                      keys.
                    </p>
                  </div>
                </>
              )}

              <button
                type="submit"
                className="mt-6 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.98]"
              >
                {wantSession ? "Signing you in…" : "Authorize this device"}
              </button>
            </form>
            <p className="mt-4 text-xs text-muted-foreground">
              You can revoke it anytime under Settings → API keys.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-destructive">
            Invalid or missing callback. Start this from the CLI with{" "}
            <code>markbase login</code>.
          </p>
        )}
      </div>
    </main>
  );
}
