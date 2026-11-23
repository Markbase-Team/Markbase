// Product events: the moments in the app that leave no row of their own.
//
// A page reports one with `trackEvent`, and POST /api/v1/events writes it to
// public.product_events for the signed-in account. The names are a fixed list
// so a page cannot fill the table with whatever it likes, and props are a few
// short strings, never free text a person typed.

import { api } from "../../api-client";

export const PRODUCT_EVENTS = [
  /** The "Connect an agent" modal opened after a first vault. */
  "connect_agent.shown",
  /** A person pressed one of its agent buttons. props.agent names which. */
  "connect_agent.clicked",
  /** It closed. props.via: "not_now" for the button, "closed" otherwise. */
  "connect_agent.dismissed",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENTS)[number];

/** Short string values only: an agent id, a surface, a way of closing. */
export type ProductEventProps = Record<string, string>;

export interface ProductEvent {
  name: ProductEventName;
  props: ProductEventProps;
}

export const EVENTS_PATH = "/api/v1/events";

const MAX_PROPS = 8;
const MAX_KEY = 40;
const MAX_VALUE = 128;

export function isProductEventName(value: string | null | undefined): value is ProductEventName {
  return typeof value === "string" && (PRODUCT_EVENTS as readonly string[]).includes(value);
}

/** What a request body may look like before it is checked. */
export interface ProductEventBody {
  name?: string;
  props?: Record<string, string | number | boolean | null | object>;
}

/**
 * The event a request body describes, or null when it is not one. Props that
 * are not short strings are dropped rather than refusing the event: a page
 * that sends a number by mistake should still be counted.
 */
export function parseProductEvent(body: ProductEventBody | null | undefined): ProductEvent | null {
  if (!body || typeof body !== "object") return null;
  if (!isProductEventName(body.name)) return null;
  const props: ProductEventProps = {};
  const raw = body.props && typeof body.props === "object" && !Array.isArray(body.props) ? body.props : {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(props).length >= MAX_PROPS) break;
    if (typeof value !== "string" || key.length === 0 || key.length > MAX_KEY) continue;
    props[key] = value.slice(0, MAX_VALUE);
  }
  return { name: body.name, props };
}

/**
 * Report an event. Fire-and-forget: a failed report must never get in the way
 * of what the person is doing, so nothing here throws or is awaited.
 */
export function trackEvent(name: ProductEventName, props: ProductEventProps = {}): void {
  void api
    .request(EVENTS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, props }),
    })
    .catch(() => undefined);
}
