import { getCurrentUser } from "@/lib/supabase/server";
import { instanceUrl } from "@/lib/instance-url";
import { parseFeatures, visibleSidebar } from "@markbase/registry/runtime";
import { AppSidebar } from "@/components/app-sidebar";
import { FEATURE_PROVIDERS } from "@/generated/feature-slots";
import { PromptDialogMount } from "@/components/prompt-dialog-mount";
import { NextNavigation } from "@/components/next-navigation";
import { SidebarInset, SidebarProvider } from "@markbase/ui/sidebar";

/**
 * Whatever the shipped features contributed, wrapped outermost-first.
 *
 * The layout used to mount ProjectsProvider by name and seed it with a
 * server-side query — which meant a release that dropped projects would not
 * compile. It now knows only that features may need providers, and the
 * generated map says which.
 */
function FeatureProviders({ children }: { children: React.ReactNode }) {
  return FEATURE_PROVIDERS.reduceRight(
    (tree, P) => <P>{tree}</P>,
    children as React.ReactNode
  );
}

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Middleware guarantees a signed-in user here; fall back gracefully.
  const [user, url] = await Promise.all([getCurrentUser(), instanceUrl()]);
  const email = user?.email ?? "";

  // Which features this build shipped, and what they put in the sidebar.
  // next.config.ts inlined the set at build time; nothing here touches disk.
  // Shipped is the only gate: nothing here is withheld per person.
  const features = visibleSidebar(parseFeatures(process.env.MARKBASE_FEATURES_JSON));

  return (
    <FeatureProviders>
      {/* Feature packages navigate through this port rather than importing
          next/navigation — see @markbase/ui/navigation. */}
      <NextNavigation>
      <PromptDialogMount>
      {/* Start collapsed: the desktop sidebar is an icon rail that hover-expands
          over the content (see AppSidebar's hoverExpand). `--app-header-h` offsets
          the rail's fixed top so it begins below the full-width AppHeader. */}
      <SidebarProvider
        defaultOpen={false}
        style={{ "--app-header-h": "2.75rem" } as React.CSSProperties}
      >
        <AppSidebar email={email} instanceUrl={url} featureEntries={features} />
        {/* One layout at every width: the rail beside it shrinks to icons on a
            small screen (AppRail's `mobile="rail"`) and nothing else changes.
            A mobile-only shell used to swap in a back-arrow header and a
            launcher menu here, from when the rail was hidden on phones. */}
        <SidebarInset className="min-w-0">{children}</SidebarInset>
      </SidebarProvider>
    </PromptDialogMount>
      </NextNavigation>
    </FeatureProviders>
  );
}
