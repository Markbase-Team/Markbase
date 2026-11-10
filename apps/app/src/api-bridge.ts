// What crosses the bridge when a local page calls the API (see preload.ts
// `api`, main.ts `registerApiIpc`, renderer/ipc-api.ts). Plain data on both
// sides: a request is a method, an API path, headers and a body a structured
// clone can carry; a response is what a page needs to rebuild a `Response`.
//
// Types only. Main, preload and the renderer are three bundles, and this file
// is the one shape all three agree on without any of them importing another.

/** A form body, as the asset upload sends one: its fields, files as bytes. */
export type DesktopApiFormField =
  | { name: string; value: string }
  | { name: string; filename: string; type: string; bytes: Uint8Array };

export interface DesktopApiRequest {
  method: string;
  /** Relative to the API: `/api/v1/...`. Main refuses anything else. */
  path: string;
  headers: Record<string, string>;
  body?: string | { form: DesktopApiFormField[] } | null;
}

export interface DesktopApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}
