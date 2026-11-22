import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Is this event target somewhere a person types — an input, a textarea, or a
 * contenteditable such as the document editor? Global shortcuts that collide
 * with an editing key (Cmd/Ctrl+B is bold) stand down while it is.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable
}
