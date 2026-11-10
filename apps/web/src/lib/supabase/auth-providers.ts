// Which sign-in providers the instance's Supabase project has turned on.
//
// A self-hosted Markbase runs on a Supabase project its admin owns, and whether
// "Continue with Google" works there is the admin's call: the Google provider
// needs their own OAuth client (SELF-HOSTING.md). The hosted app always has it.
// GoTrue says which providers are on at GET /auth/v1/settings — public, keyed
// by the publishable key every browser already holds — and the auth pages read
// it so the button can say "not on this instance" before a click, not after.

export interface AuthProviders {
  /** Google OAuth is enabled on the project. */
  google: boolean;
}

/** The GoTrue settings body, as much of it as this reads. */
interface SettingsWire {
  external?: { google?: boolean };
}

/** As much of fetch as this needs, so a test can hand in a stub. */
export type SettingsFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * What to assume when the project cannot be asked: everything on. A blip
 * reaching GoTrue must not take sign-in away from a project that has it; the
 * click then reports the real error, as it always did.
 */
export const PROVIDERS_UNKNOWN: AuthProviders = { google: true };

export function parseAuthProviders(settings: SettingsWire): AuthProviders {
  return { google: settings.external?.google === true };
}

/** The providers on this instance's project, cached a few minutes at a time. */
export async function authProviders(fetchImpl: SettingsFetch = fetch): Promise<AuthProviders> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return PROVIDERS_UNKNOWN;
  try {
    const res = await fetchImpl(`${url.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: key },
      next: { revalidate: 300 },
    });
    if (!res.ok) return PROVIDERS_UNKNOWN;
    return parseAuthProviders((await res.json()) as SettingsWire);
  } catch {
    return PROVIDERS_UNKNOWN;
  }
}
