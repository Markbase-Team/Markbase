import { inboxListHandler } from "../../../../handlers";
import { authorizedByGate } from "@markbase/shared/caller";

// Authentication happens in the shell's proxy — /api/v1/inbox and
// /api/v1/email are `required` prefixes there. These files are the URL, and
// nothing else.
export const GET = inboxListHandler(authorizedByGate);
