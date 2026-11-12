import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@markbase/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { DisplayNameField } from "@markbase/ui/display-name-field";
import { JoinLinkField } from "@markbase/ui/join-link";
import type { InstanceBridge } from "../../preload";
import type { InstanceStatus } from "../../instance";

// Settings: who this app is signed in as, which instance it is on, and — on a
// team's instance — how to invite the rest of the team.
//
// The instance is shown, not changed, here. Moving the app is what a join
// link does (markbase://connect, see ../../instance.ts) and what `markbase
// instance <url>` does from the terminal; a switch signs the app out and
// restarts it, because a key belongs to one instance, and that is not a
// setting to toggle from a dialog.

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
  userName,
  instance,
  signOut,
  onSignedOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  instance: InstanceBridge;
  signOut: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const [status, setStatus] = useState<InstanceStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    void instance.current().then(setStatus);
  }, [open, instance]);

  const here = status ? hostOf(status.appUrl) : "…";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b-0">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Signed in as <span className="font-medium text-foreground">{userName}</span>
          </DialogDescription>
        </DialogHeader>

        <DisplayNameField />

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Instance</h3>
          <p className="text-sm text-muted-foreground">
            {status === null ? (
              "…"
            ) : status.isDefault ? (
              <>
                This app is on <span className="font-medium text-foreground">{here}</span>, the hosted
                Markbase. To join a team's own instance, open its join link.
              </>
            ) : (
              <>
                This app is on your team's instance,{" "}
                <span className="font-medium text-foreground">{here}</span>.
              </>
            )}
          </p>
        </section>

        {status && !status.isDefault && <JoinLinkField />}

        <section>
          <Button
            variant="outline"
            onClick={() => void signOut().then(onSignedOut)}
            className="w-full justify-start text-destructive hover:text-destructive"
          >
            <LogOut className="size-4" />
            Log out
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
