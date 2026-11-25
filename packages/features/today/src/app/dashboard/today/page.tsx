import type { FeaturePageProps } from "@markbase/ui/page-host";
import { Today } from "../../../ui";

// The page's title ("Today!") lives on the manifest entry, which the generated
// stub turns into Next's `metadata`. It shows the built-in view `today`; the
// old per-day todo list (TodayView, /api/v1/todos) is no longer on it.
export default function TodayPage(_: FeaturePageProps) {
  return <Today />;
}
