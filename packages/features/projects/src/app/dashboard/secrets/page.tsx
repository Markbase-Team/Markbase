import type { FeaturePageProps } from "@markbase/ui/page-host";

// Secrets moved under each project (Project ▸ Secrets tab). Keep this old route
// working by sending it to the board, where you can pick a project.
// `return`, so the component's type is `never`-returning rather than `void`:
// a destructured `host` is not a typed reference TS narrows through.
export default function SecretsPage({ host }: FeaturePageProps) {
  return host.redirect(host.routes.board());
}
