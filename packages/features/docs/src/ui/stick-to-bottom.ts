import { useCallback, useEffect, useRef } from "react";

/** Close enough to the bottom to count as reading the end. */
const NEAR_BOTTOM_PX = 60;

/**
 * Keep a scrolling view at its bottom while the content grows — unless the
 * reader has scrolled up, in which case leave them where they are.
 *
 * The following flag lives inside the effect, not in a ref beside it. It was a
 * ref, written from four handlers and read from two effects, and a value shared
 * across that many render scopes is one nobody can reason about — which is also
 * what the compiler's immutability rule was objecting to. Here the only thing
 * that crosses the boundary is `stick`, a request rather than a variable.
 *
 * A ResizeObserver on the content, not just a hook on new messages: a transcript
 * is measured the instant its turns are committed, which is before markdown has
 * laid out and before any image or diagram has taken its space. Everything that
 * lands after that pushes the bottom further away, and growing fires no scroll
 * event — so without watching the height, reopening a long conversation leaves
 * you at its first message.
 */
export function useStickToBottom(): {
  /** The scrolling element. */
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** Its content — what actually changes height. */
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Jump to the bottom and follow it again, whatever the reader was doing. */
  stick: () => void;
} {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = viewportRef.current;
    const content = contentRef.current;
    if (!el || !content) return;

    let following = true;
    const toBottom = (): void => {
      el.scrollTop = el.scrollHeight;
    };
    const onScroll = (): void => {
      following = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    stickRef.current = () => {
      following = true;
      toBottom();
    };

    const observer = new ResizeObserver(() => {
      if (following) toBottom();
    });
    observer.observe(content);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
      stickRef.current = () => {};
    };
  }, []);

  const stick = useCallback(() => stickRef.current(), []);
  return { viewportRef, contentRef, stick };
}
