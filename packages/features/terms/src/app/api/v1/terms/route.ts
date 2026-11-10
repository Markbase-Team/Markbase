import { termsHandler } from "../../../../handlers";

// Authentication and CORS happen in the shell's proxy — /api/v1/terms is in
// its GUARDED list. These files are the URL, and nothing else.
export const GET = termsHandler.GET;
export const POST = termsHandler.POST;
