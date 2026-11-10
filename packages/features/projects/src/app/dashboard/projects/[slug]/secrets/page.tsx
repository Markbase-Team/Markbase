import type { FeaturePageProps } from "@markbase/ui/page-host";
import { isSecretsConfigured } from "../../../../../server";
import { SecretsManager } from "../../../../../ui/secrets-manager";

// The project layout provides the shell (tab bar + scroll container + the
// per-project state provider); this page just renders the secrets content.
export default function ProjectSecretsPage(_: FeaturePageProps) {
  return <SecretsManager configured={isSecretsConfigured()} />;
}
