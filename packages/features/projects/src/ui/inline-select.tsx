"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@markbase/ui/select";
import { cn } from "@markbase/ui/utils";

export interface InlineSelectOption {
  value: string;
  label: string;
  // Optional per-item styling (e.g. a muted "clear" entry).
  className?: string;
}

// A compact, full-width select used inline inside cards — the ticket status,
// assignee, and per-project property dropdowns all share this so they read
// identically. `triggerClassName` tints the trigger (status/property colors).
export function InlineSelect({
  value,
  onChange,
  options,
  placeholder,
  triggerClassName,
  ariaLabel,
  size = "default",
}: {
  value: string;
  onChange: (value: string) => void;
  options: InlineSelectOption[];
  placeholder?: string;
  triggerClassName?: string;
  ariaLabel?: string;
  size?: "sm" | "default";
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size={size}
        className={cn("w-full", triggerClassName)}
        aria-label={ariaLabel}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className={o.className}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
