import { vaultsHandler } from "@markbase/docs/handlers";

// Authentication and CORS happen in the proxy — /api/v1/vaults is in its
// GUARDED list. These files are the URL, and nothing else.
export const runtime = "nodejs";

export const GET = vaultsHandler.GET;
export const POST = vaultsHandler.POST;
