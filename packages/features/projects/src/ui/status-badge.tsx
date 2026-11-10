import { Badge } from "@markbase/ui/badge";
import { STATUS_LABELS, type TicketStatus } from "@markbase/protocol/types";

export const STATUS_STYLES: Record<TicketStatus, string> = {
  requested: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ready_to_execute:
    "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  in_progress:
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  review_requested:
    "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  done: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge variant="outline" className={`border-transparent ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function OwnerBadge({ label }: { label: string }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {label}
    </Badge>
  );
}
