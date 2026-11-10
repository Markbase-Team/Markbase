"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, KeySquare, LogOut, Settings } from "lucide-react";
import type { SidebarEntry } from "@markbase/registry";
import { DEFAULT_APP_URL } from "@markbase/protocol/instance";
import { JoinLinkField } from "@markbase/ui/join-link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AppRail } from "@markbase/ui/app-rail";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@markbase/ui/sidebar";
import { FEATURE_SIDEBAR_SLOTS } from "@/generated/feature-slots";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { Button } from "@markbase/ui/button";

/**
 * This shell's main sidebar: the shared AppRail, plus what only the website
 * has — the per-feature sidebar sections generated for this build, and a footer
 * for the signed-in user with API keys, Settings and Log out.
 *
 * Who sees which entry is decided in the dashboard layout, which knows both
 * the viewer and the manifests; by the time entries reach here they are
 * already filtered. Every entry is openable here, so none are tagged.
 */
export function AppSidebar({
  email,
  instanceUrl,
  featureEntries,
}: {
  email: string;
  /** This instance's own address; its join link is in Settings unless this is the hosted app. */
  instanceUrl: string;
  /** Contributed by the features this build shipped. See packages/features. */
  featureEntries: SidebarEntry[];
}) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    setSettingsOpen(false);
    router.push("/login");
    router.refresh();
  }

  return (
    <AppRail
      entries={featureEntries}
      slots={FEATURE_SIDEBAR_SLOTS}
      footer={
        // Signed-in user → drop-up → API keys, Settings (with Log out).
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <div className="flex size-8 items-center justify-center rounded-full border bg-background text-xs font-semibold">
                    {initial}
                  </div>
                  <span className="flex-1 min-w-0 truncate text-left text-[12px] group-data-[collapsible=icon]:hidden">
                    {email}
                  </span>
                  <ChevronRight className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
              >
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/api-keys">
                    <KeySquare className="size-4" />
                    API keys
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setSettingsOpen(true);
                  }}
                >
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      }
    >
      {/* Settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogHeader className="border-b-0">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Signed in as {email}</DialogDescription>
          </DialogHeader>
          {instanceUrl !== DEFAULT_APP_URL && <JoinLinkField />}
          <div>
            <Button
              variant="outline"
              onClick={logout}
              className="w-full justify-start text-destructive hover:text-destructive"
            >
              <LogOut className="size-4" />
              Log out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AppRail>
  );
}
