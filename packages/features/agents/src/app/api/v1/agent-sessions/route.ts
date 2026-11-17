// GENERATED from the endpoints defined in packages/features/agents/src/handlers
// — do not edit.
//
// An endpoint is written once, with its handler: agents.define({ id, method, path, … }, access, run).
// Change it there, then run: npm run gen:endpoints (see docs/adding-an-endpoint.md)
import { agentsRoute } from "../../../../handlers";

export const GET = agentsRoute("agents_listSessions");
export const POST = agentsRoute("agents_createSession");
