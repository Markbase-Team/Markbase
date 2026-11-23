// Every funnel event and funnel this app knows, declared where they belong and
// gathered here, so the route that accepts events and the report that reads
// them see the same registry. A feature that declares new ones is imported
// here once.
import "@markbase/shared/analytics/funnel/onboarding";
import "@markbase/docs/funnels";

export { appFunnel, onboardingFunnel, signupSource } from "@markbase/shared/analytics/funnel/onboarding";
export { docsFunnel, connectModalFunnel } from "@markbase/docs/funnels";
