import type { DocEndpoint } from "../logic/endpoints";
import type { Capability, DocAuth } from "../server";
import { accountActor, requireDocCapability } from "./actor";
import { json } from "./respond";

// One endpoint, in one place.
//
// `endpoint(def, run)` is the whole of an endpoint: what it is (its method and
// path, what it takes, what an agent is told about it), who may call it
// (`capability`), and the code that answers. Nothing about it is written
// anywhere else:
//
//   - the access check is made HERE, from `def.capability`, before `run` is
//     called — a handler cannot forget it, or check something other than what
//     its description says;
//   - the web app's route file is generated from it
//     (apps/web/scripts/gen-api-routes.ts);
//   - the plain description the CLI, the MCP server and the skill read is
//     generated from it (scripts/gen-endpoints.ts → logic/endpoints.generated.ts).
//     Those cannot import this file: it is server code, and they ship to npm
//     and to browsers.
//
// Defining an endpoint registers it, so there is no list to add it to.

/** A path's `:name` parameters, by name. */
export interface RouteParams {
  [name: string]: string;
}

/** What a per-document endpoint is handed once the caller is allowed in. */
export type AllowedOnDoc = Extract<DocAuth, { ok: true }>;

/** What an account-level endpoint is handed: whose account. */
export interface AccountCaller {
  userId: string;
}

/** An endpoint about one document: `capability` is what the caller must hold on it. */
export type DocEndpointDef = DocEndpoint & { capability: Capability };
/** An endpoint about the account: it needs a signed-in caller and nothing more. */
export type AccountEndpointDef = DocEndpoint & { capability: null };

export interface Endpoint {
  def: DocEndpoint;
  /** Check the caller, then answer. What a route calls. */
  handle: (req: Request, params: RouteParams) => Promise<Response>;
}

const defined = new Map<string, Endpoint>();

function register(e: Endpoint): Endpoint {
  if (defined.has(e.def.id)) throw new Error(`Endpoint ${e.def.id} is defined twice`);
  defined.set(e.def.id, e);
  return e;
}

/**
 * Define an endpoint.
 *
 * About one document (`capability` is a role): the caller must hold that role
 * on the document the path's `:id` names, and `run` is handed who they are and
 * the document. About the account (`capability: null`): the caller must be
 * signed in, and `run` is handed their user id.
 */
export function endpoint(
  def: DocEndpointDef,
  run: (req: Request, params: RouteParams, auth: AllowedOnDoc) => Promise<Response>
): Endpoint;
export function endpoint(
  def: AccountEndpointDef,
  run: (req: Request, params: RouteParams, caller: AccountCaller) => Promise<Response>
): Endpoint;
export function endpoint(
  def: DocEndpoint,
  run:
    | ((req: Request, params: RouteParams, auth: AllowedOnDoc) => Promise<Response>)
    | ((req: Request, params: RouteParams, caller: AccountCaller) => Promise<Response>)
): Endpoint {
  const capability = def.capability;
  if (capability === null) {
    const answer = run as (req: Request, params: RouteParams, caller: AccountCaller) => Promise<Response>;
    return register({
      def,
      handle: async (req, params) => {
        const a = await accountActor(req);
        if ("error" in a) return a.error;
        return answer(req, params, a);
      },
    });
  }
  if (!def.path.includes(":id")) {
    throw new Error(`Endpoint ${def.id} needs a role on a document but its path names none (:id)`);
  }
  const answer = run as (req: Request, params: RouteParams, auth: AllowedOnDoc) => Promise<Response>;
  return register({
    def,
    handle: async (req, params) => {
      const auth = await requireDocCapability(req, params.id, capability);
      if (!auth.ok) return json({ error: auth.error }, auth.status);
      return answer(req, params, auth);
    },
  });
}

/**
 * Define an account-level endpoint that decides for itself who may call it —
 * for the rare one whose rule depends on what is asked for. `because` says
 * why the usual check does not fit, so the exception is written down.
 */
export function selfCheckedEndpoint(
  def: AccountEndpointDef,
  because: string,
  run: (req: Request, params: RouteParams) => Promise<Response>
): Endpoint {
  if (because.trim().length < 20) throw new Error(`Endpoint ${def.id} checks itself and must say why`);
  return register({ def, handle: run });
}

/** Every endpoint defined so far, in the order they were defined. */
export function definedEndpoints(): Endpoint[] {
  return [...defined.values()];
}

/**
 * The route handler for one endpoint, in the shape a Next route file exports:
 * it waits for the path's parameters and hands them on. Throws at load for an
 * id nothing defines, so a generated route that names one cannot be deployed.
 */
export function endpointRoute(
  endpointId: string
): (req: Request, ctx: { params: Promise<RouteParams> }) => Promise<Response> {
  const e = defined.get(endpointId);
  if (!e) throw new Error(`No endpoint is defined with the id ${endpointId}`);
  return async (req, ctx) => e.handle(req, await ctx.params);
}
