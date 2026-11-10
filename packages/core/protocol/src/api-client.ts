// One API client, two authentication channels.
//
// The web sends an HTTP-only-ish cookie the browser attaches for it; everything
// without a cookie jar — the CLI, and the desktop app's local pages — sends a
// bearer key. The credential formats have nothing in common, which is not a
// reason to have two clients.
//
// The shell injects how a credential is produced. This module never detects its
// environment: a `typeof window` test here is how a library ends up with one
// branch per host, each wrong somewhere.

export type AuthHeaderProvider = () => string | null | Promise<string | null>;

/** `fetch`'s cache modes, spelled out: this package compiles without the DOM lib. */
export type ApiCacheMode = "default" | "no-store" | "reload" | "no-cache" | "force-cache" | "only-if-cached";

/** `fetch`'s init, with the cache mode a browser understands and Node's types omit. */
export interface ApiRequestInit extends RequestInit {
  cache?: ApiCacheMode;
}

/**
 * One API call, as the client hands it to whatever carries it.
 *
 * `path` is relative to the API (`/api/v1/...`); the transport decides where
 * that lives. `headers` already carry the credential, if this shell has one
 * worth sending from the page. `body` is whatever the caller gave `fetch` —
 * a JSON string, or a FormData for an upload — untouched.
 */
export interface ApiTransportRequest {
  method: string;
  path: string;
  headers: Headers;
  body?: RequestInit["body"];
  /** `fetch`'s own cache mode, for a transport that is a browser fetch. */
  cache?: ApiCacheMode;
  /**
   * Which credential channel this request is on, for a transport that is a
   * browser fetch: "omit" the cookie when a header was attached, "include" it
   * when none was. A transport that is not a browser fetch ignores this.
   */
  credentials: "omit" | "include";
}

/**
 * What carries a request to the API and brings a `Response` back.
 *
 * The default is `fetch`, which is right for every page that can reach the API
 * directly: the website (same origin, cookie), the CLI (a key, Node's fetch).
 * The desktop app's local pages cannot — they are a different origin from the
 * API, and they are not allowed to hold the key — so that shell carries the
 * request over IPC to its main process, which holds the key and makes the call,
 * and rebuilds a `Response` from what comes back. Callers never see which.
 */
export type ApiTransport = (req: ApiTransportRequest) => Promise<Response>;

class ApiClient {
  private base = "";
  private getAuthHeader: AuthHeaderProvider = () => null;
  private transport: ApiTransport = (req) => this.fetchTransport(req);

  /**
   * Where the API lives. The web leaves it alone — same origin — and the CLI
   * points it at the site. Read only by the default transport: a shell that
   * installed its own already knows where the API is.
   */
  configureBaseUrl(url: string): void {
    this.base = url.replace(/\/$/, "");
  }

  /**
   * How this shell produces an `Authorization` header, if it has one.
   *
   * Returning a promise is the point, not a convenience: it is where a shell
   * refreshes an expired token, or re-reads a key that was written after the
   * page loaded, without a single caller knowing it happened.
   */
  configureAuth(provider: AuthHeaderProvider): void {
    this.getAuthHeader = provider;
  }

  /**
   * What carries the request, when it is not this page's own `fetch`. Every
   * caller keeps calling `request()` and reading a `Response`; only the shell
   * that installs a transport knows the call left by another route. `null`
   * puts the page's own fetch back.
   */
  configureTransport(transport: ApiTransport | null): void {
    this.transport = transport ?? ((req) => this.fetchTransport(req));
  }

  async request(path: string, init: ApiRequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const auth = await this.getAuthHeader();
    if (auth) headers.set("authorization", auth);

    // One request, one channel.
    //
    // The usual rule is "attach cookies when in a browser". That is wrong here:
    // the desktop's renderer IS a browser and it holds a key, so the rule would
    // send both credentials on every request and leave the server to guess.
    // (It guesses correctly — `resolveCaller` reads the key first, precisely so
    // a capped machine stays capped — but a request should not need saving.)
    return this.transport({
      method: init.method ?? "GET",
      path,
      headers,
      body: init.body,
      cache: init.cache,
      credentials: auth ? "omit" : "include",
    });
  }

  /** The default transport: this page's own `fetch`, against the base URL. */
  private fetchTransport(req: ApiTransportRequest): Promise<Response> {
    const init: ApiRequestInit = {
      method: req.method,
      headers: req.headers,
      body: req.body,
      cache: req.cache,
      credentials: req.credentials,
    };
    return fetch(`${this.base}${req.path}`, init);
  }

  /** JSON in, JSON out, a refusal as an exception — what callers actually want. */
  async json<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const res = await this.request(path, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
    // A body that isn't JSON (a proxy's HTML error page, an empty 204) must not
    // surface as "Unexpected token <" — the status is the more useful answer.
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  }
}

/** The one client. Each shell configures it once, at startup. */
export const api = new ApiClient();
