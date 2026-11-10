"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { submitKeys } from "@markbase/ui/keys";

// An in-app replacement for window.prompt().
//
// Electron does not implement prompt() — it THROWS "prompt() is not supported."
// So every caller died mid-handler and the feature silently did nothing: new
// folder, rename folder, rename vault, and insert-link were all dead in the
// desktop app while working fine in a browser. Nothing logged where a user would
// see it, which is why it read as "the button does nothing".
//
// Promise-based on purpose, so a call site stays a single line and keeps reading
// top-to-bottom:
//
//     const name = await ask({ title: "New folder name" });
//     if (!name) return;
//
// One dialog is mounted for the whole dashboard; `ask` resolves with the trimmed
// value, or null if dismissed — the same contract prompt() had, so call sites did
// not have to be restructured around it.

type Ask = (opts: {
  title: string;
  /** Pre-filled value, as prompt()'s second argument did. */
  initial?: string;
  /** Button label. "Save" reads wrong for creating something. */
  confirmLabel?: string;
  placeholder?: string;
}) => Promise<string | null>;

const PromptContext = createContext<Ask | null>(null);

/** Ask the user for a string. Throws if no PromptProvider is mounted above. */
export function usePrompt(): Ask {
  const ask = useContext(PromptContext);
  if (!ask) throw new Error("usePrompt needs a <PromptProvider> above it");
  return ask;
}

export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [confirmLabel, setConfirmLabel] = useState("OK");
  const [placeholder, setPlaceholder] = useState("");
  const [value, setValue] = useState("");
  // Held across renders so `ask` can resolve from the dialog's own handlers.
  const resolveRef = useRef<((v: string | null) => void) | null>(null);

  const settle = useCallback((v: string | null) => {
    resolveRef.current?.(v);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const ask = useCallback<Ask>((opts) => {
    // A second ask while one is open would strand the first promise forever.
    resolveRef.current?.(null);
    setTitle(opts.title);
    setConfirmLabel(opts.confirmLabel ?? "OK");
    setPlaceholder(opts.placeholder ?? "");
    setValue(opts.initial ?? "");
    setOpen(true);
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  // useCallback so it is plainly a deferred handler: `submitKeys({onSubmit})` is
  // evaluated during render, and settle reaches a ref, which is only allowed
  // because nothing calls this until a key is pressed.
  const submit = useCallback(() => {
    const trimmed = value.trim();
    settle(trimmed || null); // empty is a cancel, exactly as prompt() behaved
  }, [value, settle]);

  return (
    <PromptContext.Provider value={ask}>
      {children}
      <Dialog
        open={open}
        // Covers Escape, the X, and a click outside — all of which must resolve
        // the promise, or the caller waits forever on a dialog that is gone.
        onOpenChange={(next) => {
          if (!next) settle(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            // submitKeys BUILDS a handler and returns it; it never calls
            // onSubmit itself, so the ref `submit` reaches is not touched until
            // a key is actually pressed.
            // eslint-disable-next-line react-hooks/refs
            onKeyDown={submitKeys({ onSubmit: submit })}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={!value.trim()}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PromptContext.Provider>
  );
}
