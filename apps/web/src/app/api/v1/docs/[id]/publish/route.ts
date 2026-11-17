// GENERATED from the endpoints defined in packages/features/docs/src/handlers
// — do not edit.
//
// An endpoint is written once, with its handler: endpoint({ id, method, path, … }, run).
// Change it there, then run: npm run gen:endpoints (see docs/adding-an-endpoint.md)
import { endpointRoute } from "@markbase/docs/handlers";

export const runtime = "nodejs";

export const GET = endpointRoute("docs_publishStatus");
export const POST = endpointRoute("docs_publish");
export const DELETE = endpointRoute("docs_unpublish");
