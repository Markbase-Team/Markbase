import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { enabledFeatures, loadFeatures, repoRoot } from "@markbase/registry";
import {
  APP_ROUTE_GROUP_DIRS,
  appRouteStubs,
  sidebarSlotsModule,
} from "@markbase/registry/web";

// Writes what this build generates from the feature manifests. Run before
// `next build`, `next dev` and `tsc`, so the output always matches
// MARKBASE_FEATURES rather than whatever was last on disk:
//
//  - src/generated/feature-slots.ts — the sidebar slot map and the providers.
//  - src/app/(features)/… and src/app/dashboard/(features)/… — one route file
//    per entry in a feature's `contributes.app`. These two directories are
//    emptied first: a route left over from a build with more features would
//    import a package this build does not ship.
const features = enabledFeatures(loadFeatures());
const webSrc = join(repoRoot(), "apps/web/src");

const slots = join(webSrc, "generated/feature-slots.ts");
mkdirSync(dirname(slots), { recursive: true });
writeFileSync(slots, sidebarSlotsModule(features));
console.log(`wrote ${slots}`);

for (const dir of APP_ROUTE_GROUP_DIRS) {
  const abs = join(webSrc, "app", dir);
  if (existsSync(abs)) rmSync(abs, { recursive: true });
}
const stubs = appRouteStubs(features);
for (const stub of stubs) {
  const abs = join(webSrc, "app", stub.file);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, stub.source);
}
console.log(`wrote ${stubs.length} contributed route file(s) under ${join(webSrc, "app")}`);
