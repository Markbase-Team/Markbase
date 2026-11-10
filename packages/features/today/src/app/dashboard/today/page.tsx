import type { FeaturePageProps } from "@markbase/ui/page-host";
import { TodayView } from "../../../ui";

// The page's title ("Today!") lives on the manifest entry, which the generated
// stub turns into Next's `metadata`.
export default function TodayPage(_: FeaturePageProps) {
  return <TodayView />;
}
