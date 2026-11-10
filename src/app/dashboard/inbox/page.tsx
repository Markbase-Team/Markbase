import type { FeaturePageProps } from "@markbase/ui/page-host";

// Inbox is merged into Attention (a tab there). Keep this path working for any
// old links/bookmarks by redirecting to wherever the shell puts that page.
// `return`, so the component's type is `never`-returning rather than `void`:
// a destructured `host` is not a typed reference TS narrows through.
export default function InboxPage({ host }: FeaturePageProps) {
  return host.redirect(host.routes.attention());
}
