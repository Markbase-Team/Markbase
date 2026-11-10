"use client";

import { useState } from "react";
import { ArrowLeftRight, Globe, Settings } from "lucide-react";
import { connectLink, DEFAULT_APP_URL, normalizeInstanceUrl } from "@markbase/protocol/instance";
import { Button } from "@markbase/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import { Input } from "@markbase/ui/input";

// Which instance the desktop app is on, and the way to another one: a small
// settings button in the top-right corner of the sign-in, sign-up and join
// pages when they are inside the app's window, and nowhere else — in a
// browser the instance is simply the site.
//
// Moving the app is a connect link (markbase://connect?instance=…), the same
// one a join page hands it. Navigating this window to it is caught by the app,
// which confirms, saves the instance and restarts on it. The page never talks
// to the app directly, so an instance's page cannot move the app without the
// person seeing the question.
export function InstanceSwitcher({ appUrl }: { appUrl: string }) {
  const host = new URL(appUrl).host;
  const isDefault = appUrl === DEFAULT_APP_URL;
  const [other, setOther] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go(target: string) {
    let normalized: string;
    try {
      normalized = normalizeInstanceUrl(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setError(null);
    window.location.assign(connectLink(normalized));
  }

  return (
    <>
      <div className="fixed top-4 right-4 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground" aria-label="Instance settings">
              <Settings className="size-4" />
              {host}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              This app is on <span className="font-medium text-foreground">{host}</span>
              {isDefault ? ", the hosted Markbase." : ", your team's instance."}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {!isDefault && (
              <DropdownMenuItem onSelect={() => go(DEFAULT_APP_URL)}>
                <ArrowLeftRight className="size-4" />
                Use {new URL(DEFAULT_APP_URL).host}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                setError(null);
                setOther(true);
              }}
            >
              <Globe className="size-4" />
              Another instance…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={other} onOpenChange={setOther}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Switch instance</DialogTitle>
            <DialogDescription>
              The address of the team&apos;s Markbase. The app restarts there and you sign in or join.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go(url);
            }}
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://markbase.example.com"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              aria-label="Instance URL"
            />
            <Button type="submit" disabled={!url.trim()}>
              Switch
            </Button>
          </form>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
