"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "./utils"
import { Button } from "./button"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  // The close button normally lives in DialogHeader (which is sticky, so it can
  // never drift on scroll). Only headerless dialogs need this fallback.
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          // Constrain to the *dynamic* viewport height (dvh shrinks when mobile
          // Safari's toolbar is showing) and scroll internally. The body scrolls
          // while DialogHeader/DialogFooter stay pinned (sticky), so a tall modal
          // never hides its title or its action buttons — no more cut-off content.
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {/* Headerless dialogs only. This container is the scroll port, so an
            `absolute` child would scroll away with the content — ride a
            zero-height sticky strip whose resting position equals its stuck
            position (-mt-4), so it never drifts or jumps. */}
        {showCloseButton && (
          <div className="sticky top-[-1rem] z-30 -mt-4 h-0">
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          </div>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        // Pinned to the top of the scroll area so the title stays visible while
        // the body scrolls. The sticky inset must be -1rem (not 0): sticky pins
        // to the scrollport's *padding* edge, so top-0 would clamp it 1rem down
        // and leave a strip of body scrolling above it. -mx-4/-mt-4 bleed it over
        // the container padding; the container's gap-4 spaces the body below it.
        // pr-10 reserves room for the close button.
        "sticky top-[-1rem] z-20 -mx-4 -mt-4 flex flex-col gap-2 border-b bg-popover px-4 pt-4 pr-10 pb-4",
        className
      )}
      {...props}
    >
      {children}
      {/* The X lives in the header, not the scroll container: `sticky` makes the
          header a containing block, so this stays pinned with it instead of
          scrolling away with the body. */}
      {showCloseButton && (
        <DialogPrimitive.Close data-slot="dialog-close" asChild>
          <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Pinned to the bottom of the scroll area so the action buttons are
        // always reachable, no matter how tall the body is. The sticky inset is
        // -1rem for the same reason as the header's (sticky pins to the
        // scrollport's padding edge). Opaque background so the body scrolls
        // behind it cleanly; the body's own spacing gives the margin above it; the
        // bottom padding respects the iOS safe area on full-screen mobile dialogs.
        "sticky bottom-[-1rem] z-20 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-popover px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
