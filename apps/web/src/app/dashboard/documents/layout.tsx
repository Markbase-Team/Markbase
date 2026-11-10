import { getCurrentUser } from "@/lib/supabase/server";
import { ownerDisplayName } from "@markbase/docs/server";
import { DocsSurface } from "@/components/docs-surface";

// The documents surface is three columns: the documentation sidebar (tree +
// vault switcher), the open-document tab strip, and the active doc — the last
// rendered by DocsShell's keep-alive stack so switching tabs never remounts the
// editor. The shell is a client component (it owns focus + open-tab state), so
// every /dashboard/documents/* route renders inside it.
//
// No Suspense around the surface, on purpose. It used to have one (for the
// `useSearchParams` inside), and that made the whole surface a STREAMED
// boundary: the HTML shell went out with an empty placeholder where the surface
// belongs, the surface followed in a hidden <div>, and React's inline runtime
// swapped it in. React schedules that first swap with requestAnimationFrame —
// which a hidden document never gets. A window that is behind another window
// (macOS reports it occluded, so the document is `hidden`) therefore never
// revealed the surface: no hydration, no vault or document fetch, no paint,
// for as long as it stayed covered — and the moment it was uncovered, the
// editor arrived ~0.3 s later. Measured as 6.5–7.3 s "stalls" on 4 of 10 warm
// loads, with DOMContentLoaded on time and ~1 KiB transferred.
//
// In the shell, the surface hydrates and loads its document whether or not the
// window is visible, like the desktop's local page does. The boundary is not
// needed: every route here reads cookies, so it is rendered dynamically, and
// `useSearchParams` only suspends in a static prerender.
//
// This layout is an async Server Component and therefore passes DocsShell only
// serializable props. The routing pair it also needs is two functions, which
// cannot cross that boundary — so it is declared inside DocsSurface, on the
// client. See the comment there.
export default async function DocumentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  // A display name, not the email. This is what gets recorded as the author of
  // versions this browser writes, and version entries live inside the Y.Doc —
  // which replicates to everyone the document is shared with.
  const userName = user ? await ownerDisplayName(user.id, user.email ?? null) : "";
  return (
    <DocsSurface userId={user?.id ?? null} userName={userName}>
      {children}
    </DocsSurface>
  );
}
