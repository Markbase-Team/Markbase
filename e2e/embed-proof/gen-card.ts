// Writes the real cards' pages (packages/shared/src/docs/apps) for the local
// instance, for the fake host to load: the app card, and the document card
// with the embed on (its "Open full page" button).
import { writeFileSync } from "node:fs";
import { appAppHtml } from "../../packages/shared/src/docs/apps/app-app";
import { docAppHtml } from "../../packages/shared/src/docs/apps/doc-app";

const instance = process.argv[2] ?? "https://localhost:3443";
writeFileSync(new URL("./proxy/app-card.html", import.meta.url), appAppHtml(instance));
writeFileSync(new URL("./proxy/doc-card.html", import.meta.url), docAppHtml(`${instance}/open?doc=`, instance));
