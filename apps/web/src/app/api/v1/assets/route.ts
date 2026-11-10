import { assetsHandler } from "@markbase/docs/handlers";

// Authentication and CORS happen in the proxy — /api/v1/assets is in its
// GUARDED list. These files are the URL, and nothing else.
export const runtime = "nodejs";

export const GET = assetsHandler.GET;
export const POST = assetsHandler.POST;
