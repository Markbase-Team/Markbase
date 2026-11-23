import { useEffect, useRef, type RefObject } from "react";

/**
 * A ref that holds the newest `value`, for callbacks that outlive the render
 * they were made in.
 *
 * An editor extension, a subscription, or a DOM listener is configured once and
 * then keeps running. Handing it a prop directly captures whatever that prop was
 * on the render that configured it, so it goes stale; rebuilding the thing on
 * every change is worse, because rebuilding an editor throws away its state.
 * Reading through a ref is the way out, and eight places had grown their own
 * copy of it.
 *
 * The assignment is in an effect rather than in the render body. Writing during
 * render is what `react-hooks/refs` forbids, and it is right to: a render can be
 * thrown away or replayed, and a ref written during one keeps the value from a
 * pass that never reached the screen. The cost is that the ref trails by one
 * commit — which does not matter here, because every reader is an event or an
 * async callback, and both run after effects have flushed. It matters for a
 * value read DURING render or in a layout effect; do not use this for those.
 *
 * The first render needs no effect: useRef seeds it with the value it was given.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
