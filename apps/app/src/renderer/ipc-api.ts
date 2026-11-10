// The desktop implementation of the API client's transport.
//
// `api` (packages/core/protocol) is the one client every feature's UI calls,
// and it carries a request with whatever transport the shell installed — by
// default, the page's own `fetch`. These pages do not get that: they are served
// from markbase://app, a different origin from the API, and they are not
// allowed to hold the key that would authenticate them to it. So the request
// goes over the bridge instead. Main attaches the key it keeps, makes the call
// with Node's fetch, and sends back the status, headers and body; this file
// turns those back into the `Response` the caller was promised.
//
// The same seam as ipc-crdt.ts in the docs feature: the thing the components
// depend on is described as an interface, and the shell hands in the one that
// fits where it runs.

import type { ApiTransport, ApiTransportRequest } from "@markbase/protocol/api-client";
import type { DesktopApiFormField, DesktopApiRequest } from "../api-bridge";
import type { ApiBridge } from "../preload";

/**
 * Carries `api`'s requests over the bridge. Install with `api.configureTransport`.
 *
 * Takes the window's `api` slice rather than reaching for the bridge itself:
 * which window has one belongs to the page that calls `shell(kind)`, not to
 * this transport.
 */
export function ipcApiTransport(bridge: ApiBridge): ApiTransport {
  return async (req) => {
    const reply = await bridge({
      method: req.method,
      path: req.path,
      headers: Object.fromEntries(req.headers),
      body: await wireBody(req.body),
    });
    // A status that forbids a body (204 from a DELETE, 304) is one the Response
    // constructor refuses a body for, even an empty one.
    const body = NO_BODY.has(reply.status) ? null : reply.body;
    return new Response(body, {
      status: reply.status,
      statusText: reply.statusText,
      headers: reply.headers,
    });
  };
}

const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * The body in a form a structured clone can carry. Strings cross as they are.
 * A FormData (the asset upload) crosses as its fields, each file read into
 * bytes here, and main rebuilds the form on its side. Anything else the client
 * is not sending today, and is refused rather than silently dropped.
 */
async function wireBody(body: ApiTransportRequest["body"]): Promise<DesktopApiRequest["body"]> {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof FormData) {
    const form: DesktopApiFormField[] = [];
    for (const [name, value] of body) {
      if (typeof value === "string") form.push({ name, value });
      else
        form.push({
          name,
          filename: value.name,
          type: value.type,
          bytes: new Uint8Array(await value.arrayBuffer()),
        });
    }
    return { form };
  }
  throw new Error("The desktop API bridge carries string and FormData bodies only.");
}
