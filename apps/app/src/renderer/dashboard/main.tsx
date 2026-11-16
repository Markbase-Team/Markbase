import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileText, Loader2 } from "lucide-react";
import { api } from "@markbase/protocol/api-client";
import { DocsShell, type DocsPorts, type DocsRouting } from "@markbase/docs/ui";
import { Button } from "@markbase/ui/button";
import { ComingSoonBadge } from "@markbase/ui/coming-soon";
import { useNavigation } from "@markbase/ui/navigation";
import { PromptProvider } from "@markbase/ui/prompt-dialog";
import { SidebarInset, SidebarProvider } from "@markbase/ui/sidebar";
import { Toaster } from "@markbase/ui/sonner";
import { ipcApiTransport } from "../ipc-api";
import { shell } from "../shell";
import { desktopDocsPorts } from "./desktop-ports";
import { DesktopNavigation } from "./desktop-navigation";
import { DesktopRail } from "./desktop-rail";
import { DefaultOpenerOffer } from "./default-opener-offer";
import "./dashboard.css";

// The app, rendered here rather than fetched from the site.
//
// The main window used to load https://markbase.so/dashboard/... and let the
// website draw the app. This page is the desktop's counterpart of the website's
// dashboard layout: the main sidebar (the icon rail, shell chrome shared by
// every feature) around whichever feature surface the path names — today the
// documents surface, mounted from the SAME <DocsShell /> the website mounts,
// over the same API, reached through the main process with the app's key
// instead of by cookie. What travels is data, not a UI: the window works the
// moment the API answers, never waits on a page load, and a signed-out app
// shows the site's /login only to sign in.

// Where this shell puts documents. The same scheme as the website, and not by
// accident: main.ts serves this page at every /dashboard path, so a document URL
// means the same thing in both, and a vault file handed to the app opens as
// `/dashboard/documents/<id>` here exactly as it does there. Each shell spells
// its own — the feature package is forbidden from knowing this (see the route
// ownership test in @markbase/protocol).
const DOCUMENTS = "/dashboard/documents";

// This window's slice of the bridge: the API, sign-in, and what the documents
// surface asks its host for — vaults, the agent, snapshots on disk, the Tabs
// menu. Other windows get other slices (see preload.ts).
const bridge = shell("dashboard");
const ports: DocsPorts = desktopDocsPorts(bridge);

const routing: DocsRouting = {
  docUrl(docId, vault) {
    const q = vault ? `?vault=${encodeURIComponent(vault)}` : "";
    return docId ? `${DOCUMENTS}/${docId}${q}` : `${DOCUMENTS}${q}`;
  },
  idFromPath(path) {
    const parts = path.split("/").filter(Boolean);
    return parts[0] === "dashboard" && parts[1] === "documents" && parts[2]
      ? parts[2]
      : null;
  },
};

/** What /api/v1/me says about the key this app holds. */
interface Me {
  owner_id: string;
  owner_name: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; me: Me }
  | { kind: "error"; message: string };

/** The index of the documents surface: what shows until a document is opened. */
function Resting() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border bg-muted">
        <FileText className="size-6 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Open a document from the sidebar, or press{" "}
        <span className="font-medium text-foreground">+</span> to create one.
      </p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full flex-col items-center justify-center gap-3 px-6 text-center">
      {children}
    </div>
  );
}

/**
 * A path the rail lists but this app does not draw yet. Reachable only by
 * URL — the rail renders those entries unclickable — so this is a backstop
 * that says what is going on and offers the way back.
 */
function NotHereYet() {
  const { push } = useNavigation();
  return (
    <Centered>
      <ComingSoonBadge />
      <p className="text-sm text-muted-foreground">
        This part of Markbase isn&apos;t in the desktop app yet.
      </p>
      <Button variant="outline" onClick={() => push(DOCUMENTS)}>
        Open Documents
      </Button>
    </Centered>
  );
}

/** The feature surface the current path names. */
function Surface({ me }: { me: Me }) {
  const { pathname } = useNavigation();
  const documents = pathname === DOCUMENTS || pathname.startsWith(`${DOCUMENTS}/`);
  if (!documents) return <NotHereYet />;
  return (
    <DocsShell userId={me.owner_id} userName={me.owner_name} routing={routing} ports={ports}>
      <Resting />
    </DocsShell>
  );
}

/**
 * No key: go straight to the sign-in page. This window used to show "This
 * Mac isn't signed in to Markbase" with a button, as if being signed out were
 * news; it is not — the one thing to do here is sign in, so do it. Main runs
 * the flow, loads the site's /login into this window, and brings it back to
 * the documents surface itself; the spinner covers the moment in between.
 */
function signIn(): void {
  void bridge.auth.signIn();
}

function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    const { loggedIn } = await bridge.auth.credentials();
    if (!loggedIn) {
      signIn();
      return;
    }
    try {
      const me = await api.json<Me>("/api/v1/me");
      setPhase({ kind: "ready", me });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The API refusing the key is the one failure a sign-in fixes. Everything
      // else — offline, a 500 — is said as it is, with a retry.
      if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden/i.test(message)) signIn();
      else setPhase({ kind: "error", message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase.kind === "loading") {
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </Centered>
    );
  }
  if (phase.kind === "error") {
    return (
      <Centered>
        <p className="text-sm font-medium">Couldn&apos;t reach Markbase</p>
        <p className="text-sm text-muted-foreground">{phase.message}</p>
        <Button variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      </Centered>
    );
  }
  return (
    // The same arrangement as the website's dashboard layout: the rail sits
    // collapsed to icons and hover-expands over the content; `--app-header-h`
    // starts it below the header row. `--traffic-light-inset` is what a
    // feature's header row reserves for the macOS traffic lights: they span the
    // first 76px of the window, the rail's cap covers the first 3rem (48px) of
    // that, so the header beside it owes the remaining 28px.
    <SidebarProvider
      defaultOpen={false}
      style={{ "--app-header-h": "2.75rem", "--traffic-light-inset": "28px" } as React.CSSProperties}
    >
      <DesktopRail
        userName={phase.me.owner_name}
        signOut={bridge.auth.signOut}
        onSignedOut={() => void load()}
        instance={bridge.instance}
        agents={bridge.agents}
        onOpenSettings={bridge.onOpenSettings}
      />
      <SidebarInset className="min-w-0">
        <Surface me={phase.me} />
      </SidebarInset>
      <DefaultOpenerOffer defaultOpener={bridge.defaultOpener} />
    </SidebarProvider>
  );
}

// Every API call this page makes goes over the bridge: main holds the key and
// makes the request (see ../ipc-api.ts). Installed before the first render so
// nothing a component fetches on mount leaves by the page's own fetch, which
// has neither the key nor the origin to succeed.
api.configureTransport(ipcApiTransport(bridge.api));
createRoot(document.getElementById("root")!).render(
  <DesktopNavigation>
    <PromptProvider>
      <App />
      <Toaster />
    </PromptProvider>
  </DesktopNavigation>
);
