import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_API_DIRS, generatedApiRoutes } from "./api-routes";

// Writes the documents API's route files from the endpoint registry.
//
//   npm run gen:api -w @markbase/web            write them
//   npm run gen:api -w @markbase/web -- --check fail if they are out of date
//
// The files are committed, so a checkout runs without generating anything; a
// test (test/api-routes-generated.test.ts) runs the same comparison as --check.

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../src/app/api/v1");

function routeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name === "route.ts" ? [p] : [];
  });
}

const wanted = generatedApiRoutes();
const wantedPaths = new Set(wanted.map((r) => join(apiRoot, r.file)));
const onDisk = GENERATED_API_DIRS.flatMap((d) => routeFiles(join(apiRoot, d)));
const stale = onDisk.filter((f) => !wantedPaths.has(f));
const changed = wanted.filter((r) => {
  const abs = join(apiRoot, r.file);
  return !existsSync(abs) || readFileSync(abs, "utf8") !== r.source;
});

if (process.argv.includes("--check")) {
  if (stale.length || changed.length) {
    console.error(
      "The API route files are out of date with the endpoint registry:\n" +
        [...changed.map((r) => `  to write  ${r.file}`), ...stale.map((f) => `  to remove ${f.slice(apiRoot.length + 1)}`)].join("\n") +
        "\nRun: npm run gen:api -w @markbase/web  — then commit."
    );
    process.exit(1);
  }
  console.log(`api routes are up to date (${wanted.length} files)`);
} else {
  for (const f of stale) rmSync(f);
  for (const r of changed) {
    const abs = join(apiRoot, r.file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, r.source);
  }
  console.log(`wrote ${changed.length}, removed ${stale.length}, of ${wanted.length} api route file(s)`);
}
