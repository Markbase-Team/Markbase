import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Is this key event part of composing text in an IME, rather than a command?
 *
 * Typing Chinese, Japanese or Korean goes through an input method: the keys you
 * press build a candidate, and Enter CONFIRMS that candidate. To the page it is
 * an ordinary Enter, so a handler that submits on Enter fires while the user was
 * only finishing a word — the message went out mid-sentence, in the middle of
 * typing it.
 *
 * `isComposing` is the standard answer. `keyCode === 229` is the older signal
 * some engines still send for the same moment, and it costs nothing to keep:
 * being wrong here means sending someone's half-written sentence.
 *
 * Exported for the places this file's `submitKeys` cannot cover — a suggestion
 * menu handling arrows, Tab and Enter together, and returning whether it
 * consumed the key. Anything that is simply "Enter submits" should use
 * `submitKeys` instead, so the guard cannot be forgotten.
 */
export function isComposingKey(
  event: KeyboardEvent | { nativeEvent: KeyboardEvent }
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}

export interface SubmitKeysOptions {
  /**
   * Enter was pressed and meant it. `shift` is passed through for the fields
   * that give Shift+Enter a second meaning — find-previous, say — and is always
   * false for a multiline field, where Shift+Enter is a newline.
   */
  onSubmit: (shift: boolean) => void;
  /** Esc, for fields that close or cancel on it. */
  onEscape?: () => void;
  /**
   * A textarea. Shift+Enter inserts a newline and is left alone; plain Enter
   * submits. Omit for a single-line input, where Shift+Enter reaches onSubmit.
   */
  multiline?: boolean;
}

/**
 * The keyboard behaviour of "type here, press Enter" — in one place, so every
 * input in the app agrees and none of them can forget the IME guard.
 *
 * That guard is why this exists as a shared handler rather than a convention.
 * It had been written out by hand at three call sites and missed at seven,
 * including the agent's message box: typing Chinese there, the Enter that
 * confirms a candidate sent the half-finished message instead.
 *
 *   <textarea onKeyDown={submitKeys({ onSubmit: send, onEscape: stop, multiline: true })} />
 */
export function submitKeys({
  onSubmit,
  onEscape,
  multiline,
}: SubmitKeysOptions): (event: ReactKeyboardEvent) => void {
  return (event: ReactKeyboardEvent): void => {
    // Never act on a key that is building a word. Escape included: it cancels
    // the IME's candidate list, and closing the dialog underneath instead would
    // be its own kind of rude.
    if (isComposingKey(event)) return;

    if (event.key === "Enter") {
      if (multiline && event.shiftKey) return; // a newline, not a submit
      event.preventDefault();
      onSubmit(event.shiftKey);
      return;
    }
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
    }
  };
}
