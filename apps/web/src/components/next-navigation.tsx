"use client";

import NextLink from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NavigationProvider } from "@markbase/ui/navigation";
import { shellRoutes } from "@/lib/shell-routes";

/**
 * This shell's answer to the navigation port.
 *
 * Everything Next-specific about routing lives here, in one file, so feature
 * packages can navigate without importing `next/navigation`. A desktop shell
 * writes its own version of exactly this and reuses the features unchanged.
 */
export function NextNavigation({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <NavigationProvider
      value={{
        pathname,
        searchParams,
        push: (href) => router.push(href),
        refresh: () => router.refresh(),
        // Where this shell puts the pages features need to link to — the
        // same table the server page host answers from.
        routes: shellRoutes,
        Link: NextLink,
      }}
    >
      {children}
    </NavigationProvider>
  );
}
