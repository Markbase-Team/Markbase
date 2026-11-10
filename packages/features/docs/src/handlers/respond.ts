// How this surface writes a response. Transport only: the status and the
// headers a handler asked for, and nothing about who may read it — CORS is
// the gate's, and these never spell it.

/** A JSON body. `headers` is merged on top — the asset list adds an ETag. */
export function json<T>(
  data: T,
  status = 200,
  headers?: Record<string, string>
): Response {
  return Response.json(data, { status, headers });
}

/** A body-less response — a 304, say — with the headers it must carry. */
export function empty(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { status, headers });
}
