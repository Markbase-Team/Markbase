import NextLink from "next/link";
import { notFound, redirect } from "next/navigation";
import type { PageHost } from "@markbase/ui/page-host";
import { getCurrentUser } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/features";
import { shellRoutes } from "@/lib/shell-routes";

/**
 * This shell's answer to the page port.
 *
 * Everything a contributed page needs that only a Next app can supply, in one
 * object: the cookie session, the two navigation throws, the Claude Code gate
 * and the link component. The generated route stubs hand this to every page
 * and layout a feature contributes (see `appRouteStubs` in the registry), so
 * the packages never import `next/*` and the desktop shell can mount the same
 * pages with a host of its own.
 */
export const pageHost: PageHost = {
  viewer: async () => {
    const user = await getCurrentUser();
    return user ? { id: user.id, email: user.email ?? null } : null;
  },
  redirect,
  notFound,
  requireFeature,
  routes: shellRoutes,
  Link: NextLink,
};
