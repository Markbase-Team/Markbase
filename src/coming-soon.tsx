import { Badge } from "./badge";
import { cn } from "./utils";

/**
 * The small tag beside something that is shown but cannot be used yet — a menu
 * item, a sidebar entry. One component so every "coming soon" in the app is the
 * same size and tone, and so turning a feature on means deleting the tag, not
 * hunting for the styling.
 */
export function ComingSoonBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("h-4 px-1.5 text-[10px] font-normal text-muted-foreground", className)}
    >
      Coming soon
    </Badge>
  );
}
