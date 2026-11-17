// GENERATED from the endpoint registry — do not edit.
//
// An endpoint is defined once, with its handler, in
// packages/features/docs/src/handlers: endpoint({ id, method, path, … }, run).
// Change it there, then run: npm run gen:endpoints (see docs/adding-an-endpoint.md)
import { endpointRoute } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export const PATCH = endpointRoute("docs_resolveComment");
