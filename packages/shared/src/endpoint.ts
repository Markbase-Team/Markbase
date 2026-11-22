import { callerFromHeaders, type Caller } from "./auth";

// One endpoint, in one place — for any feature.
//
// An endpoint is written once, beside the code that answers it:
//
//   const api = endpointSet<EndpointDef>("terms");
//   export const listTermsEndpoint = api.define(
//     { id: "terms_listTerms", method: "GET", path: "/terms", scope: "read", summary: "…" },
//     signedIn,
//     async (req, params, caller) => { … }
//   );
//
// That one definition is what the endpoint IS (method, path, what it takes,
// what an agent is told), WHO may call it (the access check, which runs before
// the code and cannot be forgotten), and the CODE. Everything else is made
// from it: the route file (endpoint-gen.ts), and — for endpoints agents may
// call — the plain description the MCP server, the skill and the CLI read
// (endpoint-gen.ts, endpoint-tools.ts).
//
// A feature keeps its own set, and may narrow the description with fields of
// its own (documents adds `capability`, the role a caller needs on a document).
// How a caller is checked is the feature's too: `signedIn` here is the common
// case, and a feature supplies any other check as an `Access`.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type EndpointScope = "read" | "write";
export type ParamType = "string" | "number" | "boolean" | "json";

// A body/query parameter (path params like :id are derived from `path`, not
// listed here). Drives the MCP tool's JSON input schema.
export interface EndpointParam {
  name: string;
  type: ParamType;
  required?: boolean;
  description?: string;
}

// How an agent should use an endpoint — rendered into the skill verbatim.
export interface EndpointSkillDoc {
  /** When to reach for this endpoint. */
  whenToUse: string;
  /** The request body / query it expects (one line). "" for none. */
  input: string;
  /** What it returns (one line). */
  output: string;
  /** Optional copy-pasteable example (a JSON body or a curl one-liner). */
  example?: string;
}

/** What an endpoint is — everything about it that is not code. */
export interface EndpointDef {
  /** `<feature>_<verbNoun>`. The MCP tool's name; unique across the API. */
  id: string;
  method: HttpMethod;
  /** Path under /api/v1, e.g. "/docs/:id/edits". */
  path: string;
  /** OAuth-style scope the API key must carry. */
  scope: EndpointScope;
  /** Body/query parameters (path params are derived from `path`). */
  params?: readonly EndpointParam[];
  /** One-line summary: the tool's description, the endpoints table. */
  summary: string;
  /** Not for agents: hidden from the MCP server, the skill and `markbase api`. */
  humanOnly?: boolean;
  /**
   * Why an agent may not call it — required beside `humanOnly`, so leaving an
   * endpoint out of the agents' tools is a decision somebody wrote down, never
   * an omission.
   */
  why?: string;
  /** It removes something that cannot be brought back. Told to the agent's client. */
  destructive?: boolean;
  /** Present when this endpoint is documented in the agent skill. */
  skill?: EndpointSkillDoc;
}

/** A path's `:name` parameters, by name. */
export interface RouteParams {
  [name: string]: string;
}

/** The `:name` parameters of a path, in order. */
export function pathParams(path: string): string[] {
  return [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
}

/**
 * Who may call an endpoint, decided from the request before its code runs.
 * Answers what the code is handed (`ctx`), or the refusal to send.
 */
export type Access<Ctx> = (
  req: Request,
  params: RouteParams
) => Promise<{ ok: true; ctx: Ctx } | { ok: false; response: Response }>;

/** The common check: the gate attached a caller (a session or an API key). */
export const signedIn: Access<Caller> = async (req) => {
  const caller = callerFromHeaders(req.headers);
  if (!caller) {
    return { ok: false, response: Response.json({ error: "Missing credentials." }, { status: 401 }) };
  }
  return { ok: true, ctx: caller };
};

/** A defined endpoint: its description, and the way to call it. */
export interface Endpoint<Def extends EndpointDef = EndpointDef> {
  def: Def;
  /** Check the caller, then answer. What a route calls. */
  handle: (req: Request, params: RouteParams) => Promise<Response>;
}

/** The route handler Next expects a route file to export. */
export type RouteHandler = (req: Request, ctx: { params: Promise<RouteParams> }) => Promise<Response>;

export interface EndpointSet<Def extends EndpointDef> {
  /** Define an endpoint: `access` decides who may call it, `run` answers. */
  define<Ctx>(
    def: Def,
    access: Access<Ctx>,
    run: (req: Request, params: RouteParams, ctx: Ctx) => Promise<Response>
  ): Endpoint<Def>;
  /**
   * Define an endpoint that decides for itself who may call it — for the rare
   * one whose rule depends on what is asked for. `because` says why no shared
   * check fits, so the exception is written down.
   */
  selfChecked(
    def: Def,
    because: string,
    run: (req: Request, params: RouteParams) => Promise<Response>
  ): Endpoint<Def>;
  /** Every endpoint defined so far, in the order they were defined. */
  defined(): Endpoint<Def>[];
  /**
   * The route handler for one endpoint. Throws at load for an id nothing
   * defines, so a generated route that names one cannot be deployed.
   */
  route(endpointId: string): RouteHandler;
}

/**
 * A feature's endpoints. `feature` prefixes every id (`docs_readDoc`), which is
 * what keeps ids — and so MCP tool names — unique across features.
 */
export function endpointSet<Def extends EndpointDef>(feature: string): EndpointSet<Def> {
  const defined = new Map<string, Endpoint<Def>>();

  function register(e: Endpoint<Def>): Endpoint<Def> {
    const { id, humanOnly, why } = e.def;
    if (!new RegExp(`^${feature}_[a-zA-Z][a-zA-Z0-9]*$`).test(id)) {
      throw new Error(`Endpoint id ${id} must be ${feature}_<name>`);
    }
    if (defined.has(id)) throw new Error(`Endpoint ${id} is defined twice`);
    if (humanOnly && (why ?? "").trim().length < 20) {
      throw new Error(`Endpoint ${id} is hidden from agents and must say why`);
    }
    if (!humanOnly && why !== undefined) {
      throw new Error(`Endpoint ${id} says why it is hidden from agents, but is not`);
    }
    defined.set(id, e);
    return e;
  }

  return {
    define(def, access, run) {
      return register({
        def,
        handle: async (req, params) => {
          const allowed = await access(req, params);
          if (!allowed.ok) return allowed.response;
          return run(req, params, allowed.ctx);
        },
      });
    },
    selfChecked(def, because, run) {
      if (because.trim().length < 20) throw new Error(`Endpoint ${def.id} checks itself and must say why`);
      return register({ def, handle: run });
    },
    defined: () => [...defined.values()],
    route(endpointId) {
      const e = defined.get(endpointId);
      if (!e) throw new Error(`No endpoint is defined with the id ${endpointId}`);
      return async (req, ctx) => e.handle(req, await ctx.params);
    },
  };
}
