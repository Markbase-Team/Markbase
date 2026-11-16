import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, LogOut, Settings } from "lucide-react";
import { parseFeatures, visibleSidebar } from "@markbase/registry/runtime";
import { AppRail } from "@markbase/ui/app-rail";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@markbase/ui/sidebar";
import type { AgentsBridge, InstanceBridge } from "../../preload";
import { SettingsDialog } from "./settings-dialog";

// This shell's main sidebar: the shared AppRail with what only the desktop app
// has — which entries it can open itself, and a footer for the signed-in user.
// The footer says who that is first. Hovering it opens its menu: Settings
// (which instance the app is on, and the way back to the hosted one) and
// Log out. It offered "Switch account" for a day, which re-ran the sign-in flow
// — but the window still held the site session, so the same account came
// straight back and nothing visibly happened. Logging out forgets the key and
// clears that session; the next sign-in starts from the login form, with
// whichever account.
//
// Every shipped feature is listed, the same as on the website, so the app reads
// as one product; the ones this app does not draw yet are tagged rather than
// hidden, which also says where the desktop is going. No viewer filtering: the
// list is inlined at build time (vite.config.mts), and the API, not the rail,
// decides what a key may touch.

/** Sidebar entry ids this app opens itself. Everything else is "coming soon". */
const AVAILABLE: ReadonlySet<string> = new Set(["documents"]);

export function DesktopRail({
  userName,
  signOut,
  onSignedOut,
  instance,
  agents,
  onOpenSettings,
}: {
  userName: string;
  /** Forget this app's key and stop syncing. */
  signOut: () => Promise<void>;
  /** The log-out finished; the surface re-reads who it is for (nobody, now). */
  onSignedOut: () => void;
  /** Which instance this app is on, and switching. */
  instance: InstanceBridge;
  agents: AgentsBridge;
  /** Main asks for Settings from the tray or the Vaults menu. */
  onOpenSettings: (cb: () => void) => () => void;
}) {
  // Inlined by the build from the feature manifests, like the website's.
  const entries = useMemo(
    () => visibleSidebar(parseFeatures(process.env.MARKBASE_FEATURES_JSON)),
    []
  );
  const initial = userName.trim().charAt(0).toUpperCase() || "?";
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => onOpenSettings(() => setSettingsOpen(true)), [onOpenSettings]);

  // The menu opens on hover and stays while the pointer is on it or its row;
  // a short grace period covers the gap between the two. A click still works.
  const [menuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverIn = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setMenuOpen(true);
  };
  const hoverOut = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenuOpen(false), 150);
  };

  return (
    <AppRail
      entries={entries}
      available={AVAILABLE}
      footer={
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={`Signed in as ${userName}`}
                  className="data-[state=open]:bg-sidebar-accent"
                  onMouseEnter={hoverIn}
                  onMouseLeave={hoverOut}
                >
                  <div className="flex size-8 items-center justify-center rounded-full border bg-background text-xs font-semibold">
                    {initial}
                  </div>
                  <span className="flex-1 min-w-0 truncate text-left text-[12px] group-data-[collapsible=icon]:hidden">
                    {userName}
                  </span>
                  <ChevronRight className="ml-auto size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
              >
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Signed in as <span className="font-medium text-foreground">{userName}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void signOut().then(onSignedOut)}>
                  <LogOut className="size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      }
    >
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        userName={userName}
        instance={instance}
        agents={agents}
        signOut={signOut}
        onSignedOut={onSignedOut}
      />
    </AppRail>
  );
}
