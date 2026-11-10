import { useSyncExternalStore } from "react";

/** These values are fixed once the browser has them; there is nothing to watch. */
const subscribeNever = (): (() => void) => () => {};

/**
 * A value only the browser can produce, with what the server should render
 * instead.
 *
 * The shape this replaces was a state seeded with the fallback and corrected by
 * an effect. It works, but it says the wrong thing: the state is never really
 * `serverValue`, it is unknown until mounted, and the effect exists to hide that
 * for one commit. Reading during render instead is not an option either — the
 * server has no localStorage, so the two renders would disagree and hydration
 * would warn.
 *
 * useSyncExternalStore is the API for exactly this: one snapshot for the server
 * and hydration, another for the browser afterwards. `read` must return a value
 * that compares equal across calls when nothing has changed — a primitive, or a
 * cached object — or React will re-render without end.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeNever, read, () => serverValue);
}
