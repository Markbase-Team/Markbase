import type { FeaturePageProps } from "@markbase/ui/page-host";
import { SkillWorkspace } from "../../../../ui";

export default async function SkillWorkspacePage({
  params,
}: FeaturePageProps<{ id: string }>) {
  const { id } = await params;
  return <SkillWorkspace skillId={id} />;
}
