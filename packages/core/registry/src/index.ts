// Build-time entry points (these reach node:fs). App code must import
// "@markbase/registry/runtime" instead — see runtime.ts.
export {
  FeatureManifest,
  SidebarEntry,
  AppRoute,
  APP_ROUTE_PATH,
  featureJsonSchema,
} from "./schema";
export { loadFeatures, enabledFeatures, repoRoot } from "./load";
export type { LoadedFeature } from "./load";
export {
  transpilePackages,
  KERNEL_PACKAGES,
  featuresEnvValue,
  disabledRoutesEnvValue,
  appRouteStubs,
  APP_ROUTE_GROUP,
} from "./web";
export type { AppRouteStub } from "./web";
export { sidebarEntries } from "./sidebar";
