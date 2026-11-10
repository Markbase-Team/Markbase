import { docsHandler } from "@markbase/docs/handlers";

// Authentication and CORS happen in the proxy — /api/v1/docs is in its
// GUARDED list. These files are the URL, and nothing else.
export const runtime = "nodejs";

export const GET = docsHandler.GET;
export const POST = docsHandler.POST;
