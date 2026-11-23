// Writes the real app card's page (packages/shared/src/docs/apps/app-app.ts)
// for the local instance, for the fake host to load.
import { writeFileSync } from "node:fs";
import { appAppHtml } from "../../packages/shared/src/docs/apps/app-app";

writeFileSync(new URL("./proxy/app-card.html", import.meta.url), appAppHtml(process.argv[2] ?? "https://localhost:3443"));
