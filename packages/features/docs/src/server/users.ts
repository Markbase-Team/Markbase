import { supabase } from "@markbase/protocol/supabase";

// A person's name, as others see it: on a published page, on a version, in a
// share invitation.
//
// There is no profiles table; the name lives in the account's auth metadata.
// Two sources, in this order:
//
//   1. `display_name` — what the person set in Settings. Always wins.
//   2. `full_name` / `name` — what a Google sign-in brought along. Nobody typed
//      it into Markbase, and it is rewritten from the Google profile on every
//      sign-in, which is why the chosen name has a key of its own.
//
// An email-and-password account has neither until the person sets one.

/** The auth metadata keys a name can be in. */
export interface NameMetadata {
  display_name?: string | null;
  full_name?: string | null;
  name?: string | null;
}

/** Longest display name accepted — a name, not a paragraph. */
export const DISPLAY_NAME_MAX = 80;

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

/** The name to show for this metadata: the chosen one, else the sign-in's, else null. */
export function resolveName(meta: NameMetadata | null | undefined): string | null {
  return clean(meta?.display_name) ?? clean(meta?.full_name) ?? clean(meta?.name);
}

export async function getUserDisplay(
  userId: string
): Promise<{ email: string | null; name: string | null }> {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const u = data?.user;
    return {
      email: u?.email ?? null,
      name: resolveName(u?.user_metadata as NameMetadata | undefined),
    };
  } catch {
    return { email: null, name: null };
  }
}

/** What Settings shows: the name the person chose (if any), and what is shown without one. */
export interface UserProfile {
  email: string | null;
  /** The name set in Settings; null when none was. */
  display_name: string | null;
  /** The sign-in's name — what is used while `display_name` is null. */
  fallback_name: string | null;
}

export async function getUserProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);
  const meta = (data.user?.user_metadata ?? {}) as NameMetadata;
  return {
    email: data.user?.email ?? null,
    display_name: clean(meta.display_name),
    fallback_name: clean(meta.full_name) ?? clean(meta.name),
  };
}

/**
 * Set (or, with an empty string, clear) the name the person chose. Merged
 * into the metadata the account already has, so the sign-in's own keys stay.
 */
export async function setUserDisplayName(userId: string, displayName: string): Promise<UserProfile> {
  const name = clean(displayName);
  if (name && name.length > DISPLAY_NAME_MAX) {
    throw new Error(`A display name is at most ${DISPLAY_NAME_MAX} characters.`);
  }
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);
  const meta = { ...(data.user?.user_metadata ?? {}), display_name: name };
  const updated = await supabase.auth.admin.updateUserById(userId, { user_metadata: meta });
  if (updated.error) throw new Error(updated.error.message);
  return getUserProfile(userId);
}
