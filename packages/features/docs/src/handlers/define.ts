import {
  endpointSet,
  type Access,
  type Endpoint as DefinedEndpoint,
  type RouteParams,
} from "@markbase/protocol/endpoint";
import type { DocEndpoint } from "@markbase/protocol/docs/endpoints";
import type { Capability, DocAuth, SignedInActor } from "../server";
import { accountActor, requireDocCapability } from "./actor";
import { json } from "./respond";

// The documents feature's endpoints.
//
// An endpoint is written once — what it is, who may call it, and its code —
// with the machinery every feature shares (@markbase/protocol/endpoint). What
// is the documents feature's own is here: the two ways a caller is checked.
//
//   - `capability` is a role: the caller must hold it on the document the
//     path's `:id` names, and the code is handed who they are and the document.
//   - `capability` is null: the caller must be signed in, and the code is
//     handed their user id.
//
// `endpoint(def, run)` picks the check from `def.capability`, so the rule an
// endpoint advertises is the rule it enforces. The route files and the plain
// description the CLI, the MCP server and the skill read are generated from
// these definitions (see docs/adding-an-endpoint.md).

export type { RouteParams };
export type Endpoint = DefinedEndpoint<DocEndpoint>;

/** What a per-document endpoint is handed once the caller is allowed in. */
export type AllowedOnDoc = Extract<DocAuth, { ok: true }>;

/** What an account-level endpoint is handed: who is asking, with the account to scope by. */
export interface AccountCaller {
  actor: SignedInActor;
}

/** An endpoint about one document: `capability` is what the caller must hold on it. */
export type DocEndpointDef = DocEndpoint & { capability: Capability };
/** An endpoint about the account: it needs a signed-in caller and nothing more. */
export type AccountEndpointDef = DocEndpoint & { capability: null };

const docsEndpoints = endpointSet<DocEndpoint>("docs");

/** The caller holds at least `need` on the document `:id` names. */
function roleOnDoc(need: Capability): Access<AllowedOnDoc> {
  return async (req, params) => {
    const auth = await requireDocCapability(req, params.id, need);
    return auth.ok ? { ok: true, ctx: auth } : { ok: false, response: json({ error: auth.error }, auth.status) };
  };
}

/** The caller is signed in to an account. */
const account: Access<AccountCaller> = async (req) => {
  const a = await accountActor(req);
  return "error" in a ? { ok: false, response: a.error } : { ok: true, ctx: a };
};

/**
 * Define a documents endpoint. The access check comes from `def.capability`
 * and runs before `run`: a role on the document, or a signed-in caller.
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
  if (def.capability === null) {
    return docsEndpoints.define(
      def,
      account,
      run as (req: Request, params: RouteParams, caller: AccountCaller) => Promise<Response>
    );
  }
  if (!def.path.includes(":id")) {
    throw new Error(`Endpoint ${def.id} needs a role on a document but its path names none (:id)`);
  }
  return docsEndpoints.define(
    def,
    roleOnDoc(def.capability),
    run as (req: Request, params: RouteParams, auth: AllowedOnDoc) => Promise<Response>
  );
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
  return docsEndpoints.selfChecked(def, because, run);
}

/** Every documents endpoint defined so far, in the order they were defined. */
export const definedEndpoints = docsEndpoints.defined;

/** The route handler for one documents endpoint, as a route file exports it. */
export const endpointRoute = docsEndpoints.route;
