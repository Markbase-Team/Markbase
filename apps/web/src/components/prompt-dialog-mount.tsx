"use client";

import { PromptProvider } from "@markbase/ui/prompt-dialog";

// The layout is a server component, so the provider needs a client boundary of
// its own to be mounted there.
export function PromptDialogMount({ children }: { children: React.ReactNode }) {
  return <PromptProvider>{children}</PromptProvider>;
}
